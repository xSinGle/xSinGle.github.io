---
title: 'Spark Core [源码解析][MemoryManager抽象类]'
date: 2020-05-04 17:22:54
tags:
---

首先来看官方对于MemoryManager的解释：

> MemoryManager抽象类规定了内存如何在计算与存储之间进行分配。执行内存(ExecutionMemory)用于计算操作如shuffle,join,sort,aggregation等，而存储内存(StorageMemory)用于内部数据的缓存以及其在集群间的传播，每个JVM都存在一个MemoryManager。


从宏观上看待**memoryManager**管理的**4块内存池**如下:

* 分为堆内内存(ON_HEAP)与堆外内存(OFF_HEAP)
* 按功能又分为用于存储的内存(Storage)与用于计算的内存(Execution)
* 内存池中分为空闲内存(MemoryFree)和占用内存(MemoryUsed)

![MemoryManager内存管理模型](MemoryManager抽象类.png)


## 构造参数

* **conf** 即SparkConf
* **numCores** CPU内核数
* **onHeapStorageMemory** 用于存储的堆内内存大小
* **onHeapExecutionMemory** 用于计算的堆内内存大小

```scala
private[spark] abstract class MemoryManager(
    conf: SparkConf,
    numCores: Int,
    onHeapStorageMemory: Long,
    onHeapExecutionMemory: Long) extends Logging {...}
```

## 内存池实例化

根据**MemoryMode**来实例化对应的内存池实例。这里是一个关键点，观察MemoryManager抽象类的定义的方法可以发现，大部分对内存的获取，释放操作，都是通过调用对应MemoryPool的实例方法来实现的，MemoryManager只是对对应的内存池方法进行封装并调用，所以要实现对内存的管理，首先要创建对应的内存池实例。

```scala
  @GuardedBy("this")
	// 堆内存储内存池
  protected val onHeapStorageMemoryPool = new StorageMemoryPool(this, MemoryMode.ON_HEAP)
  @GuardedBy("this")
	// 堆外存储内存池
  protected val offHeapStorageMemoryPool = new StorageMemoryPool(this, MemoryMode.OFF_HEAP)
  @GuardedBy("this")
	// 堆内执行内存池
  protected val onHeapExecutionMemoryPool = new ExecutionMemoryPool(this, MemoryMode.ON_HEAP)
  @GuardedBy("this")
	// 堆外执行内存池
  protected val offHeapExecutionMemoryPool = new ExecutionMemoryPool(this, MemoryMode.OFF_HEAP)
```

## 属性与解释

| 属性                           | 解释                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| **conf**                       | 即SparkConf。                                                |
| **numCores**                   | CPU内核数。                                                  |
| **onHeapStorageMemory**        | 用于存储的堆内内存大小。                                     |
| **onHeapExecutionMemory**      | 用于计算的对内内存大小。                                     |
| **onHeapStorageMemoryPool**    | 用于对内内存的存储内存池，大小由onHeapStorageMemory决定。(StorageMemoryPool) |
| **offHeapStorageMemoryPool**   | 用于堆外内存的存储内存池。(StorageMemoryPool)                |
| **offHeapExecutionMemory**     | 用于堆外内存的执行内存池。                                   |
| **onHeapExecutionMemoryPool**  | 用于堆内内存的执行内存池，大小由onHeapExecutionMemory决定。(ExecutionMemoryPool) |
| **offHeapExecutionMemoryPool** | 用于堆外内存的执行内存池。(ExectuionMemoryPool)              |
| **offHeapExecutionMemory**     | 用于计算的堆内内存大小。                                     |
| **maxOffHeapMemory**           | 堆外内存最大值。通过spark.memory.offHeap.size属性指定，默认为0。 |
| **offHeapStorageMemory**       | 用于存储的堆外内存大小。                                     |


## Storage相关方法

上面有提到，MemoryManager实际上是通过MemoryPool来实现的。如对StorageMemory内存的操控，实际上都是通过调用StorageMemoryPool的方法进行操作。

| 方法                        | 解释                                                         |
| --------------------------- | ------------------------------------------------------------ |
| **maxOnHeapStorageMemory**  | 返回用于存储的最大堆内内存，需要子类实现。                   |
| **maxOffHeapStorageMemory** | 返回用于存储的最大堆外内存，需要子类实现。                   |
| **setMemoryStore**          | 给on/offHeapStorageMemoryPool设置MemoryStore，实际上调用的就是StorageMemoryPool的setMemoryStore方法。 |
| **acquireStorageMemory**    | 为了存储BlockId对应的block，从堆外或堆内内存中获取numBytes的内存。返回布尔值，是否获取成功。如果有必要，会驱逐部分内存中的block数据释放内存。 |
| **acquireUnrollMemory**     | 为了展开BlockId对应的block，从堆外或者堆内内存中获取numBytes的内存。返回布尔值，是否获取成功。如果有必要，会驱逐部分内存中的block数据释放内存。 |

### releaseStorageMemory

从堆内内存或堆外内存中释放numBytes大小的内存。实际上调用的就是**StorageMemoryPool**的**releaseMemory**方法。

```scala
  def releaseStorageMemory(numBytes: Long, memoryMode: MemoryMode): Unit = synchronized {
    memoryMode match {
      case MemoryMode.ON_HEAP => onHeapStorageMemoryPool.releaseMemory(numBytes)
      case MemoryMode.OFF_HEAP => offHeapStorageMemoryPool.releaseMemory(numBytes)
    }
  }
```

### releaseAllStorageMemory

从堆内或堆外内存中释放所有内存。实际上调用的就是**StorageMemoryPool**中的**releaseAllMemory**方法。

```scala
  final def releaseAllStorageMemory(): Unit = synchronized {
    onHeapStorageMemoryPool.releaseAllMemory()
    offHeapStorageMemoryPool.releaseAllMemory()
  }
```

### releaseUnrollMemory

释放numBytes大小的展开内存，实际上调用的是releaseStorageMemory方法。

```scala
  final def releaseUnrollMemory(numBytes: Long, memoryMode: MemoryMode): Unit = synchronized {
    releaseStorageMemory(numBytes, memoryMode)
  }
```

### storageMemoryUsed

用于存储的堆外内存与堆内内存总和。

```scala
  final def executionMemoryUsed: Long = synchronized {
    onHeapExecutionMemoryPool.memoryUsed + offHeapExecutionMemoryPool.memoryUsed
  }
```

## Execution相关方法

执行内存的管理原理与Storage相同，对ExecutionMemory的操控，实际上都是通过调用ExecutionMemoryPool的方法进行操作。

### acquireExecutionMemory

为taskAttemptId对应的任务尝试，在堆内内存或堆外内存中获取numBytes大小的内存。

```scala
  private[memory]
  def acquireExecutionMemory(
      numBytes: Long,
      taskAttemptId: Long,
      memoryMode: MemoryMode): Long
```

### releaseExecutionMemory

从堆内内存或堆外内存中释放taskAttemptId对应的任务尝试所消费的numBytes的执行内存。实际调用**ExecutionMemoryPool**的**releaseMemory**方法。

```scala
  private[memory]
  def releaseExecutionMemory(
      numBytes: Long,
      taskAttemptId: Long,
      memoryMode: MemoryMode): Unit = synchronized {
    memoryMode match {
    // 可以看到实际调用的是ExecutionMemoryPool的方法进行操作
      case MemoryMode.ON_HEAP => onHeapExecutionMemoryPool.releaseMemory(numBytes, taskAttemptId)
      case MemoryMode.OFF_HEAP => offHeapExecutionMemoryPool.releaseMemory(numBytes, taskAttemptId)
    }
  }
```

### releaseAllExecutionMemoryForTask

从堆内内存以及堆外内存中，释放taskAttemptId对应的任务尝试所消费的所有执行内存，返回释放的内存大小值。实际上调用的也是**ExecutionMemoryPool**的**releaseAllMemoryForTask**方法。

```scala
  private[memory] def releaseAllExecutionMemoryForTask(taskAttemptId: Long): Long = synchronized {
  // 实际上调用的也是ExecutionMemoryPool的releaseAllMemoryForTask方法
    onHeapExecutionMemoryPool.releaseAllMemoryForTask(taskAttemptId) +
      offHeapExecutionMemoryPool.releaseAllMemoryForTask(taskAttemptId)
  }
```

### executionMemoryUsed

获取堆内执行内存池与堆外执行内存池已经使用的内存之和。

```scala
final def executionMemoryUsed: Long = synchronized {  onHeapExecutionMemoryPool.memoryUsed + 
offHeapExecutionMemoryPool.memoryUsed}
```

### getExecutionMemoryUsageForTask

获取指定taskAttemptId对应的任务尝试在堆内与堆外所消费的执行内存之和。

```scala
  private[memory] def getExecutionMemoryUsageForTask(taskAttemptId: Long): Long = synchronized {
  // 实际上调用了ExecutionMemoryPool的getMemoryUsageForTask方法
    onHeapExecutionMemoryPool.getMemoryUsageForTask(taskAttemptId) +
      offHeapExecutionMemoryPool.getMemoryUsageForTask(taskAttemptId)
  }
```

总结：

1. 规定了执行内存与管理内存的分配方式。(参考开头的4块内存池模型)
2. 定义了管理内存的基本方法，包括内存的获取，释放，统计。
3. MemoryManager对内存的管理本质上是通过MemoryPool实现的。

