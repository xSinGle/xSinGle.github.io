---
title: 'Spark Core [源码解析] MemoryPool'
date: 2020-05-16 14:24:09
tags:
---

![MemoryPool](MemoryPool.png)

## MemoryMode

* 内存池实际上是对物理内存的逻辑规划
* **Spark**用内存模式(**MemoryMode**)从逻辑上区分为堆内内存与堆外内存
* **MemoryMode**为枚举类型，定义了堆内内存**ON_HEAP**与堆外内存**OFF_HEAP**

```java
@Private
public enum MemoryMode {
  ON_HEAP,
  OFF_HEAP
}
```

## MemoryPool抽象类

内存池抽象类的基本方法与属性如下:

| 属性/方法             | 解释                                                         |
| --------------------- | ------------------------------------------------------------ |
| **lock**              | 接收lock作为参数，保证操作内存池的线程安全。                 |
| **\_poolSize**        | 内存池的大小(bytes)。                                        |
| **poolSize**          | 返回\_poolSize内存池大小的方法。                             |
| **memoryUsed**        | 获取已经使用的内存大小(bytes)，此方法需要子类实现。          |
| **memoryFree**        | 获取内存池中可用的内存大小(bytes)，即_poolSize与memoryUsed的差值。 |
| **incrementPoolSize** | 给内存池扩容，扩容大小为delta，delta必须为正。               |
| **decrementPoolSize** | 给内存池缩容，缩容大小为delta，delta必须为正，delta必须小于内存池总大小，缩小后剩余的内存池大小必须大于已经被使用的内存(即已经使用的内存不可以从内存池中移除)。 |

```scala
private[memory] abstract class MemoryPool(lock: Object) {
  @GuardedBy("lock")
  private[this] var _poolSize: Long = 0

  final def poolSize: Long = lock.synchronized {
    _poolSize
  }
  final def memoryFree: Long = lock.synchronized {
    _poolSize - memoryUsed
  }
  final def incrementPoolSize(delta: Long): Unit = lock.synchronized {
    require(delta >= 0)
    _poolSize += delta
  }
  final def decrementPoolSize(delta: Long): Unit = lock.synchronized {
    require(delta >= 0)
    require(delta <= _poolSize)
    require(_poolSize - delta >= memoryUsed)
    _poolSize -= delta
  }
  def memoryUsed: Long
}
```

## 宏观关系

**MemoryPool**抽象类有两种具体实现:

* **StorageMemoryPool** 存储体系用到的内存池
* **ExecutionMemoryPool** 计算引擎用到的内存池

他们都受到**MemoryManager**的统一管理，而**MemoryManager**也有两种具体实现:

* **StaticMemoryManager** 静态内存管理(存储与计算内存池大小固定)
* **UnifiedMemoryManager** 统一内存管理(存储与计算内存池互相借用，动态分配)

![MemoryPool宏观关系](MemoryPool宏观关系.png)

## StorageMemoryPool

| 属性/方法            | 解释                                                         |
| -------------------- | ------------------------------------------------------------ |
| **lock**             | 继承了MemoryPool的lock属性，保证操作内存的线程安全。         |
| \_**poolSize**       | 继承了MemoryPool的属性，StorageMemoryPool内存池的大小。      |
| **MemoryMode**       | 内存模式，在逻辑上区分用于存储的内存是堆外内存offHeap还是堆内内存onHeap。offHeap内存为sun.misc.Unsafe的API分配的系统内存，onHeap内存为系统分配给JVM内存的一部分。 |
| **poolName**         | 内存池名称，如果MemoryMode.ON_HEAP则名称为on-heap storage,如果是MemoryMode.OFF_HEAP,则名称为off-heap storage。 |
| \_**memoryUsed**     | 已经使用的内存大小(bytes)                                    |
| **memoryUsed**       | 实现MemoryPool的方法，返回\_memoryUsed的值。                 |
| \_**memoryStore**    | StorageMemoryPool所关联的MemoryStore。                       |
| **memoryStore**      | 返回\_memoryStore属性引用的MemoryStore。                     |
| **setMemoryStore**   | 设置当前StorageMemoryPool所关联的MemoryStore，实际设置了\_memoryStore属性。 |
| **releaseAllMemory** | 释放当前内存池的所有内存，即将\_memoryUsed设置为0。          |

**以下为重点方法详解**

### acquireMemory

此方法用于给**blockId**对应的**block**，获取**numBytes**指定大小的内存。

* 首先计算**numBytes**与**memoryFree**的差值，如果**numBytesToFree**>0，说明空闲的内存空间不足，需要驱逐部分**block**占用的内存空间，然后调用重载的**acquireMemory**方法申请内存。

```scala
  def acquireMemory(blockId: BlockId, numBytes: Long): Boolean = lock.synchronized {
    val numBytesToFree = math.max(0, numBytes - memoryFree)
    acquireMemory(blockId, numBytes, numBytesToFree)
  }
```

* 重载的**acquireMemory**方法，用于为**blockId**对应的**block**获取该**block**所需(**numBytesToAcquire**)大小的内存。
* 当**StorageMemoryPool**内存不足的时候，需要腾出其他**block**占用的内存给当前的**block**，腾出的大小由**numBytesToFree**决定(即不足的空间大小)。

1. 调用**MemoryStore**的**evictBlocksToFreeSpace**方法，腾出**numBytesToFree**属性指定大小的空间。
2. 当前**StorageMemoryPool**的空闲内存(**memoryFree**)是否充足。即**numBytesToAcquire** <= **memoryFree**
3. 如果内存充足，则将**numBytesToAcquire**增加到**_memoryUsed**属性上，即逻辑上获得了用于存储**block**的内存空间。
4. 返回**enoughMemory**布尔值，表示是否成功获得了**block**所需要的内存空间。 

```scala
  def acquireMemory(
      blockId: BlockId,
      numBytesToAcquire: Long,
      numBytesToFree: Long): Boolean = lock.synchronized {
    assert(numBytesToAcquire >= 0)
    assert(numBytesToFree >= 0)
    assert(memoryUsed <= poolSize)
    if (numBytesToFree > 0) {
      memoryStore.evictBlocksToFreeSpace(Some(blockId), numBytesToFree, memoryMode)
    }
    val enoughMemory = numBytesToAcquire <= memoryFree
    if (enoughMemory) {
      _memoryUsed += numBytesToAcquire
    }
    enoughMemory
  }
```

### releaseMemory

* 释放指定大小的内存空间

1. 如果需要释放的内存空间大小大于已经被使用的内存大小，可以理解为释放所有被占用的内存，将**_memoryUsed**直接清零。
2. 否则，就在占用内存里减去释放的内存空间，即逻辑上释放了**size**大小的内存。

```scala
  def releaseMemory(size: Long): Unit = lock.synchronized {
    if (size > _memoryUsed) {
      logWarning(s"Attempted to release $size bytes of storage " +
        s"memory when we only have ${_memoryUsed} bytes")
      _memoryUsed = 0
    } else {
      _memoryUsed -= size
    }
  }
```

### freeSpaceToShrinkPool

* 缩小指定大小的内存池空间。

1. 对比**spaceToFree**和**memoryFree**的大小，如果**spaceToFree**小于**memoryFree**，直接返回**spaceToFree**即可。
2. 如果**spaceToFree**大于**memoryFree**，说明需要腾出占用内存的部分**block**，以补齐**spaceToFree**的大小，返回腾出的空间**spaceFreedByEviction**与**MemoryFree**的大小之和。
3. 由于驱逐了部分**block**的内存空间，所以**_memoryUsed**应该减少，但是这里没有做处理，原因是**evictBlocksToFreeSpace**的调动过程中，会调用**blockEvictionHandler**的**dropFromMemory**，而**BlockManager**的**dropFromMemory**方法会调用**StorageMemoryPool**的**releaseMemory**方法。

```scala
  def freeSpaceToShrinkPool(spaceToFree: Long): Long = lock.synchronized {
    val spaceFreedByReleasingUnusedMemory = math.min(spaceToFree, memoryFree) //两者取最小值
    val remainingSpaceToFree = spaceToFree - spaceFreedByReleasingUnusedMemory
    if (remainingSpaceToFree > 0) {// 大于0说明需要腾出空间
      val spaceFreedByEviction =
        memoryStore.evictBlocksToFreeSpace(None, remainingSpaceToFree, memoryMode)
      spaceFreedByReleasingUnusedMemory + spaceFreedByEviction
    } else { // 否则直接返回spaceToFree的值即可
      spaceFreedByReleasingUnusedMemory
    }
  }
```

***StorageMemoryPool对应的是blockId与block所需的内存大小，ExecutionMemoryPool对应的是TaskAttemptId与任务尝试所消耗的内存大小。***

## ExecutionMemoryPool

* 继承于MemoryPool，是执行内存池的具体实现，对执行内存的逻辑规划。

| 属性/方法                 | 解释                                                         |
| ------------------------- | ------------------------------------------------------------ |
| **lock**                  | 继承于MemoryPool的锁，保证操作内存池的线程安全。             |
| \_**poolSize**            | 执行内存池的大小。                                           |
| **memoryMode**            | 内存模式，ON_HEAP/OFF_HEAP两种。                             |
| **poolName**              | 内存池名称，根据memoryMode取名，on_heap execution或off_heap execution |
| **memoryForTask**         | 任务尝试的身份标识taskAttemptId与所消费内存大小之间的映射表。 |
| **memoryUsed**            | 获取已使用的内存大小(bytes)，实际上是所有TaskAttemptId所消费的内存大小之和，即memoryForTask这个Map中所有value的和。 |
| **getMemoryUsageForTask** | 获取任务尝试使用的内存大小，即memoryForTask中taskAttemptId对应的value值。 |

**以下为重点方法详解**

### acquireMemory

* 用于给**taskAttemptId**对应的任务尝试获取指定大小(**numbytes**)的内存。
  申请内存的具体执行步骤如下:

1. 如果**memoryForTask**中未包含当前**taskAttemptId**，则将当前**taskAttemptId**加入到**memoryForTask**中，并记录其消费的内存为0。唤醒其他等待获取**ExecutionMemoryPool**的线程。

2. 一直循环以下操作:
   (1) 获取当前激活的Task总数。

   (2) 获取当前任务尝试所消费的内存大小。

   (3) 调用**maybeGrowPool**方法，回收**StorageMemoryPool**从**ExecutionMemoryPool**里借用的内存。

   (4) 调用**computeMaxPoolSize**方法，计算内存池的最大大小。

   (5) 计算每个任务尝试可以使用的最大内存大小。(**maxMemoryPerTask**)

   (6) 计算每个任务尝试可以使用的最小内存大小。(**minMemoryPerTask**)

   (7) 计算当前任务尝试真正可以申请获取的内存大小。(**toGrant**)

   (8) 如果**toGrant**小于任务尝试本来要申请的内存大小，并且当前任务尝试所消费的内存大小**curMem**与可以申请获取的内存大小**toGrant**之和小于**minMemoryPerTask**。会使得当前线程处于等待状态，这说明如果任务尝试要申请的内存得不到满足，甚至连每个任务需要的最小内存1/2N都无法满足，则需要等待其他线程的任务释放内存，当其他任务释放内存后，进入下一次**loop**，直到获取到满意的内存大小。

   (9) 如果**toGrant**大于任务尝试需要申请的内存，说明真正可以申请的内存大小超出了期望获取的内存大小，或者**curMem**和**toGrant**之和大于等于**minMemoryPerTask**，说明当前任务尝试得到了最基本的内存保证(1/2N)。直接在**memoryForTask**中给该任务尝试对应的消费内存增加**toGrant**内存大小，并返回**toGrant**退出循环。


**注意： maybeGrowPool是一个在MemoryManager的子类中定义的方法，用于计算存储内存池"占用"计算内存池的内存大小，返回存储内存池应该"回收"的内存大小。**

```scala
private[memory] def acquireMemory(
      numBytes: Long,
      taskAttemptId: Long,
      // 在MemoryManager的子类中定义的方法，返回存储内存池应该归还的内存大小。
      maybeGrowPool: Long => Unit = (additionalSpaceNeeded: Long) => Unit,
      computeMaxPoolSize: () => Long = () => poolSize): Long = lock.synchronized {
    assert(numBytes > 0, s"invalid number of bytes requested: $numBytes")

    if (!memoryForTask.contains(taskAttemptId)) {
      memoryForTask(taskAttemptId) = 0L
      lock.notifyAll()
    }
    while (true) {
      val numActiveTasks = memoryForTask.keys.size 
      val curMem = memoryForTask(taskAttemptId) 

      maybeGrowPool(numBytes - memoryFree)

      val maxPoolSize = computeMaxPoolSize()
      val maxMemoryPerTask = maxPoolSize / numActiveTasks
      val minMemoryPerTask = poolSize / (2 * numActiveTasks)

      val maxToGrant = math.min(numBytes, math.max(0, maxMemoryPerTask - curMem))

      val toGrant = math.min(maxToGrant, memoryFree)

      if (toGrant < numBytes && curMem + toGrant < minMemoryPerTask) {
        logInfo(s"TID $taskAttemptId waiting for at least 1/2N of $poolName pool to be free")
        lock.wait()
      } else {
        memoryForTask(taskAttemptId) += toGrant
        return toGrant
      }
    }
    0L  
  }
```

### releaseMemory

* 用于给**taskAttemptId**对应的任务尝试释放指定大小(**numbytes**)的内存。

1. 获取**taskAttemptId**代表的任务尝试所消费的内存(**curMem**)。

2. 如果**curMem** < **numBytes**，即当前任务尝试消费的内存小于请求释放的内存，则真正需要释放的内存就是当前任务尝试消费的内存大小(**memoryToFree=curMem**)。否则，真正需要释放的内存就是请求释放的内存(**memoryToFree=numBytes**)。

3. 如果**memoryForTask**里有当前任务尝试对应的**taskAttemptId**，将它对应消费的内存大小减去本次释放的内存大小(**memoryToFree**)。

4. 如果减去**memoryToFree**大小的内存后，该**taskAttemptId**消费的内存小于等于0，则将其从**memoryForTask**中清除。

5. 唤醒所有因为调用**acquireMemory**方法申请获得内存，却因为内存不足处于等待状态的线程。

```scala
  def releaseMemory(numBytes: Long, taskAttemptId: Long): Unit = lock.synchronized {
    val curMem = memoryForTask.getOrElse(taskAttemptId, 0L)
    var memoryToFree = if (curMem < numBytes) {
      logWarning(
        s"Internal error: release called on $numBytes bytes but task only has $curMem bytes " +
          s"of memory from the $poolName pool")
      curMem
    } else {
      numBytes
    }
    if (memoryForTask.contains(taskAttemptId)) {
      memoryForTask(taskAttemptId) -= memoryToFree
      if (memoryForTask(taskAttemptId) <= 0) {
        memoryForTask.remove(taskAttemptId)
      }
    }
    lock.notifyAll()
  }
```

### releaseAllMemoryForTask

* 用于释放**taskAttemptId**对应的任务尝试所消费的所有内存。

1. 首先调用**getMemoryUsageForTask**获取该任务尝试消费的内存大小。
2. 调用**releaseMemory**方法释放内存。
3. 返回释放的内存大小。

```scala
  def releaseAllMemoryForTask(taskAttemptId: Long): Long = lock.synchronized {
    val numBytesToFree = getMemoryUsageForTask(taskAttemptId)
    releaseMemory(numBytesToFree, taskAttemptId)
    numBytesToFree
  }
```

## 重点小结

1. **StorageMemoryPool**为**blockId**对应的**block**申请指定大小的内存，**ExecutionMemoryPool**为**TaskAttemptId**对应的任务尝试获取指定大小的内存。
2. **freeSpaceToShrinkPool**决定了是否需要驱逐**Block**以释放内存，实际调用**memoryStore**的**evictBlocksToFreeSpace**，而**evictBlocksToFreeSpace**将调用**blockEvictionHandler**的**dropFromMemory**方法对内存进行释放，实际操作的是**BlockManager**的**dropFromMemory**方法，最终通过**remove**方法回到**MemoryStore**里的**releaseMemory**实现内存释放。
3. **ExecutionMemoryPool**在内存不足时，会调用**maybeGrowPool**方法回收**Storage**占用的内存，如**UnifiedMemoryManager**子类实现的**maybeGrowExecutionPool**方法，内部调用**freeSpaceToShrinkPool**释放**block**占用的内存，并对存储以及计算内存池两者大小进行调整。
4. **ExecutionMemoryPool**采用死循环的方式为**TaskAttempt**申请内存，内存至少为: 执行内存池大小\* 1/(2\*任务尝试个数)，否则将继续等待，直到其他**TaskAttempt**释放内存。


