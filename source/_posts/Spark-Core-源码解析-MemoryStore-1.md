---
title: 'Spark Core [源码解析] MemoryStore(1)'
date: 2020-05-15 22:17:04
tags:
---

![MemoryStore](MemoryStore.png)

## 概述

由于内容较多，本文将重点讲解以下几点：

1. MemoryStore的宏观内存模型。
2. Block在内存中的抽象MemoryEntry。
3. Task与内存之间的交互，包括申请，释放，统计等。

## MemoryEntry

**MemoryStore**中定义了**Block**在内存中的抽象，即特质**MemoryEntry**。

| 属性           | 解释                                   |
| -------------- | -------------------------------------- |
| **size**       | 当前Block在内存中的大小。              |
| **MemoryMode** | Block存入内存的内存模式(ON/OFF_HEAP)。 |
| **classTag**   | Block的类型标记。                      |

```scala
private sealed trait MemoryEntry[T] {
  def size: Long
  def memoryMode: MemoryMode
  def classTag: ClassTag[T]
}
```

### DeserializedMemoryEntry

反序列化后的**MemoryEntry**。
只支持堆内内存(ON_HEAP)的内存模式。

```scala
private case class DeserializedMemoryEntry[T](
    value: Array[T],
    size: Long,
    classTag: ClassTag[T]) extends MemoryEntry[T] {
  val memoryMode: MemoryMode = MemoryMode.ON_HEAP
}
```

### SerializedMemoryEntry

序列化后的**MemroyEntry**。
支持两种类型(ON/OFF_HEAP)的内存模式。

```scala
private case class SerializedMemoryEntry[T](
    buffer: ChunkedByteBuffer,
    memoryMode: MemoryMode,
    classTag: ClassTag[T]) extends MemoryEntry[T] {
  def size: Long = buffer.size
}
```

## MemoryStore属性

| 属性                       | 解释                                                         |
| -------------------------- | ------------------------------------------------------------ |
| **conf**                   | 即SparkConf。                                                |
| **blockInfoManager**       | Block信息管理器BlockInfoManager。                            |
| **serializerManager**      | 序列化管理器SerializerManager。                              |
| **memoryManager**          | 内存管理器MemoryManager。MemoryStore存储Block，用的就是MemoryManager内的maxOnHeapStorageMemory与maxOffHeapStorageMemory两块内存池。 |
| **blockEvictionHandler**   | 块驱逐处理器。用于将Block从内存中驱逐出去。blockEvictionHandler的类型是BlockEvictionHandler，其定义了将对象从内存中移除的接口。 |
| **entries**                | 内存中的BlockId与MemoryEntry(Block的内存形式)之间的映射关系的缓存。 |
| **onHeapUnrollMemoryMap**  | 任务尝试线程标识**taskAttemptId**与任务尝试**线程**在堆内内存**展开所有block所占用的内存大小之和**之间的映射关系。 |
| **offHeapUnrollMemoryMap** | 任务尝试线程标识**taskAttemptId**与任务尝试**线程**在堆外内存**展开所有block所占用的内存大小之和**之间的映射关系。 |
| **unrollMemoryThreshold**  | 用来**展开**任何Block之前，**初始请求的内存大小**，可以修改属性**spark.storage.unrollMemoryThreshold**改变大小，默认为**1MB**。 |

> 一个任务尝试线程可能会在内存中unroll多个Block。

## BlockEvictionHandler

定义了将对象从内存中移除的接口**dropFromMemory**。
官方解释：

* 用于将**block**从**memory**中驱逐。
* 当**MemoryStore**内存不足时，如果disk存在空闲空间，BlockEvictionHandler会将其**溢出**到disk上。
* 调用**dropFromMemory**的线程必须获取到**block的写锁**，但调用该方法后并**不会释放**写锁。
* **dropFromMemory**方法返回新的**StorageLevel**。


```scala
private[storage] trait BlockEvictionHandler {
  private[storage] def dropFromMemory[T: ClassTag](
      blockId: BlockId,
      data: () => Either[Array[T], ChunkedByteBuffer]): StorageLevel
}
```

如上，BlockManager实现了特质BlockEvictionHandler。并且重写了dropFromMemory方法。

```scala
  // Actual storage of where blocks are kept
  private[spark] val memoryStore =
    new MemoryStore(conf, blockInfoManager, serializerManager, memoryManager, this)
```

BlockManager在构造MemoryStore时，将**自身的引用**(this)作为**blockEvictionHandler**参数传递给**MemoryStore**的**构造器**。
<u>**所以BlockEvictionHandler就是BlockManager!**</u>

## MemoryStore方法(对MemoryStore模型提供概念上的描述)

**除了上述属性外，以下方法为MemoryStore提供了概念性描述**

> 在以下**MemoryStore**多个方法中，都将依赖属性**onHeapUnrollMemoryMap**与**offHeapUnrollMemoryMap**来对展开内存的用量进行计算，故该属性与其相关方法需要重点掌握。

### maxMemory

* **MemoryStore**用于存储**block**的最大内存。
* 实质为**maxOnHeapStorageMemory**与**maxOffHeapStorageMemory**之和。
* 若**MemoryManager**为**StaticMemoryManager**，**maxMemory**大小是<u>**固定**</u>的。
* 若**MemoryManager**为**UnifiedMemoryManager**，**maxMemory**大小是<u>**动态变化**</u>的。

```scala
  private def maxMemory: Long = {
    memoryManager.maxOnHeapStorageMemory + memoryManager.maxOffHeapStorageMemory
  }
// 如果maxMemory小于展开内存的最低阈值，会弹出WARN级别的警告信息。
  if (maxMemory < unrollMemoryThreshold) {
    logWarning(s"Max memory ${Utils.bytesToString(maxMemory)} is less than the initial memory " +
      s"threshold ${Utils.bytesToString(unrollMemoryThreshold)} needed to store a block in " +
      s"memory. Please configure Spark with more memory.")
  }
// 启动时告知MemoryStore初始容量大小。
  logInfo("MemoryStore started with capacity %s".format(Utils.bytesToString(maxMemory)))
```

### memoryUsed

* **MemoryStore**<u>**已经使用**</u>的内存大小。
* 实质为用于存储的**堆内内存**与**堆外内存**使用量**之和**。即onHeapStorageMemoryPool.memoryUsed + offHeapStorageMemoryPool.memoryUsed

```scala
  private def memoryUsed: Long = memoryManager.storageMemoryUsed
```

### currentUnrollMemory

* MemoryStore用于展开Block使用的内存大小。
* 实质为堆内外UnrollMemoryMap中所有用于展开Block所占用的内存大小总和。

```scala
  def currentUnrollMemory: Long = memoryManager.synchronized {
    onHeapUnrollMemoryMap.values.sum + offHeapUnrollMemoryMap.values.sum
  }
```

### blocksMemoryUsed

* MemoryStore用于存储block使用的内存大小
* 该值不包括用于unroll block的内存大小
* blocksMemoryUsed = memoryUsed - currentUnrollMemory

```scala
  private def blocksMemoryUsed: Long = memoryManager.synchronized {
    memoryUsed - currentUnrollMemory
  }
```

### reserveUnrollMemoryForThisTask

> 为了展开任务尝试给定的block，在指定内存模式上保留指定大小的内存。

```scala
  def reserveUnrollMemoryForThisTask(
      blockId: BlockId,
      memory: Long,
      memoryMode: MemoryMode): Boolean = {
    memoryManager.synchronized {
    // 调用MemoryManager的acquireUnrollMemory方法，
    // 为该blockId对应的block，申请指定大小的内存
      val success = memoryManager.acquireUnrollMemory(blockId, memory, memoryMode)
      if (success) {
      // 调用currentTaskAttemptId获取任务尝试标识taskAttemptId
        val taskAttemptId = currentTaskAttemptId()
        val unrollMemoryMap = memoryMode match {
        // 根据memoryMode创建taskAttemptId与该任务尝试线程在堆内或堆外展开的所有Block所占用的内存大小之和的映射表
          case MemoryMode.ON_HEAP => onHeapUnrollMemoryMap
          case MemoryMode.OFF_HEAP => offHeapUnrollMemoryMap
        }
        // 将该taskAttemptId与该任务尝试线程在堆内或堆外用于展开的所有Block所占用的内存的映射关系，更新到映射表。
        // 新的任务尝试线程，默认的占用展开内存总和为0L
        unrollMemoryMap(taskAttemptId) = unrollMemoryMap.getOrElse(taskAttemptId, 0L) + memory
      }
      success
    }
  }
```

**执行流程：**

1. 调用**MemoryManager**的**acquireUnrollMemory**方法，为该blockId对应的block，获取指定大小的内存。
2. 调用**currentTaskAttemptId**创建任务尝试标识**taskAttemptId**。
3. 根据**memoryMode**创建**taskAttemptId**与该任务尝试线程在堆内或堆外展开所有**Block**所占用的内存大小之和的**映射表** **on/offHeapUnrollMemoryMap**。
4. 将上述映射关系更新到映射表当中。返回内存获取成功或失败的状态(**success**)。


### releaseUnrollMemoryForThisTask

> 顾名思义，存在**获取**就存在**释放**，该方法用于释放任务尝试线程占用的用于展开的内存。

```scala
  def releaseUnrollMemoryForThisTask(memoryMode: MemoryMode, memory: Long = Long.MaxValue): Unit = {
  // 调用currentTaskAttemptId获取任务尝试标识taskAttemptId
    val taskAttemptId = currentTaskAttemptId()
    memoryManager.synchronized {
    // 根据memoryMode创建taskAttemptId与该任务尝试线程在堆内或堆外用于展开所有Block所占用的内存大小之和的映射表
      val unrollMemoryMap = memoryMode match {
        case MemoryMode.ON_HEAP => onHeapUnrollMemoryMap
        case MemoryMode.OFF_HEAP => offHeapUnrollMemoryMap
      }
      if (unrollMemoryMap.contains(taskAttemptId)) {
      // 若映射表中已经存在该任务尝试线程，且请求释放的内存大于其占用的内存，直接全部内存释放掉
        val memoryToRelease = math.min(memory, unrollMemoryMap(taskAttemptId))
        // 如果存在需要释放的内存(>0)
        if (memoryToRelease > 0) {
        // 更新映射表中该任务尝试线程所占用的内存
          unrollMemoryMap(taskAttemptId) -= memoryToRelease
          // 调用MemoryManager的releaseUnrollMemory方法释放内存
          memoryManager.releaseUnrollMemory(memoryToRelease, memoryMode)
        }
        // 如果没有需要释放的内存了，即该任务尝试占用内存为0
        if (unrollMemoryMap(taskAttemptId) == 0) {
        // 更新映射表，直接将该任务尝试线程与堆内或堆外展开的Block占用内存的映射关系清除
          unrollMemoryMap.remove(taskAttemptId)
        }
      }
    }
  }
```

**执行流程：**

1. 同上，获取taskAttemptId并根据MemoryMode创建on/offHeapUnrollMemoryMap映射表。
2. 计算<u>**实际需要释放**</u>的内存，即**请求释放的内存**与该**任务尝试线程实际占用的内存**之间的<u>**最小值**</u>。
3. 根据实际需要释放的内存，更新映射表。
4. 如果没有需要释放的内存了(堆内或堆外展开的Block所占用的内存为0)，直接将映射关系从映射表中删除。



### currentUnrollMemoryForThisTask

* 当前任务尝试线程用于展开Block所占用的内存
* 即当前任务尝试线程在堆内外内存中用于展开Block所占用的内存总和。
* 根据taskAttemptId在UnrollMemoryMap中获取对应的内存，默认为0L。

```scala
  def currentUnrollMemoryForThisTask: Long = memoryManager.synchronized {
    onHeapUnrollMemoryMap.getOrElse(currentTaskAttemptId(), 0L) +
      offHeapUnrollMemoryMap.getOrElse(currentTaskAttemptId(), 0L)
  }
```

### numTaskUnrolling

* 当前使用MemoryStore展开Block的任务的数量。
* 即堆内外UnrollMemoryMap中key的数量的总和。

```scala
  private def numTasksUnrolling: Int = memoryManager.synchronized {
    (onHeapUnrollMemoryMap.keys ++ offHeapUnrollMemoryMap.keys).toSet.size
  }
```


## MemoryStore内存模型

![MemoryStore内存模型](MemoryStore内存模型.png)

首先再次明确几个值的具体意义和计算方式。

* 最大内存为堆内外用于存储内存的总和。
  **maxMemory** = **onHeapStorageMemory** + **offHeapStorageMemory**

* 已经占用内存大小为堆内外存储内存池内存占用大小的总和。
  **memoryUsed** = **memoryManager.storageMemoryUsed**
  即
  **memoryUsed** = **onHeapStorageMemoryPool.memoryUsed** + **offHeapStorageMemoryPool.memoryUsed**

* 任务尝试线程展开Blcok所用的的内存总大小为<u>**每一个任务尝试线程**</u>为了展开Block所占用的内存大小的总和。
  **currentUnrollMemory** = **onHeapUnrollMemoryMap** + **offHeapUnrollMemoryMap**

现在可以来看看**MemoryStore**的内存模型了。
**MemoryStore**的内存模型分为**三部分**进行理解：

1. **blocksMemoryUsed**
   MemoryEntry的entries属性持有的很多MemoryEntry所占据的内存总和。可以理解为真正被Block数据占用了的存储内存空间。
2. **currentUnrollMemory**
   如图，每一个任务尝试线程(Task Attempt Thread 1~N)，在堆内外中，用于展开Block所占用的内存的总和。这里用于展开Block的内存类似于“占座”，即先划分出这块内存，避免后续往内存中写入Block数据时发生OOM。
3. 未被使用的**空闲内存**

* <u>**实质**</u>被Block数据(MemoryEntry)占用的内存--blocksMemoryUsed
* 所有任务尝试线程为了存储MemoryEntry“<u>**预先占用**</u>“的内存---currentUnrollMemory
  以上两者的总和即为**memoryUsed**，**消耗内存的总大小**。


## 小结

1. **Block**数据在内存中以**MemoryEntry**的形式存在，分别有序列化和非序列化两种。
2. **BlockEvictionHandler**定义了**DropFromMemory**方法，用于将**Block**数据从内存中驱逐。
3. **MemoryStore**通过调用**MemoryManager**的方法获取存储内存大小以及使用量(**MemoryManager**实质上通过**MemoryPool**获取内存的具体使用情况)。
4. 通过reserve/release/currentUnrollMemoryForThisTask描述了TaskAttempt申请/释放/计算内存的过程。
5. 最后通过**blocksMemoryUsed**，**currentUnrollMemory**描述了**MemoryStore**的内存模型。

理解了**MemoryStore**的**基本属性**，对于其**概念性描述的基本方法**，以及重要的**内存模型**，下一篇将对Block数据的存储过程进行详细的讲解。
