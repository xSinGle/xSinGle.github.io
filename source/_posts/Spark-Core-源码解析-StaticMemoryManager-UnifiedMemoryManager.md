---
title: 'Spark Core [源码解析][MemoryManager实现]'
date: 2020-05-05 19:15:15
tags:
---

![MemoryManager](MemoryManager.png)

前文针对MemoryManager抽象类的解析已经在宏观上描述了整个Spark内存管理的模型，本文将分别探讨MemoryManager的两个子类，StaticMemoryManager和UnifiedMemoryManager。

## StaticMemoryManager

在Spark1.6以前，默认使用StaticMemoryManager进行内存管理。其特点就是所分配的存储内存(StorageMemory)和执行内存(ExecutionMemory)是固定的，无法动态改变。

宏观内存分配如下：

![StaticMemoryManager](StaticMemoryManager.png)

实际上，最终**StaticMemoryManager**决定JVM内存分配调用的是其伴生对象的方法。首先看到构造方法，通过调用伴生对象的方法获取**maxOnHeapStorageMemory**和**maxOnHeapExecutionMemory**。

```scala
private[spark] class StaticMemoryManager(
    conf: SparkConf,
    maxOnHeapExecutionMemory: Long,
    override val maxOnHeapStorageMemory: Long,
    numCores: Int)
  extends MemoryManager(
    conf,
    numCores,
    maxOnHeapStorageMemory,
    maxOnHeapExecutionMemory) {

	def this(conf: SparkConf, numCores: Int) {
    this(
      conf,
      // 调用伴生对象里的getMaxExecutionMemory方法获取最大执行内存
      StaticMemoryManager.getMaxExecutionMemory(conf),
      // 调用伴生对象里的getMaxStorageMemory方法获取最大存储内存
      StaticMemoryManager.getMaxStorageMemory(conf),
      numCores)
  }
    // 省略无关代码
}
```

首先明确**spark.testing.memory**参数决定了当前JVM可用的最大堆内内存，即**systemMaxMemory**，默认调用**Runtime.getRuntime.maxMemory**获取。

### maxOnHeapStorageMemory

| Property Name                | Default | Meaning                                    |
| ---------------------------- | ------- | ------------------------------------------ |
| spark.storage.memoryFraction | 0.6     | Storage内存占系统内存的比例                |
| spark.storage.unrollFraction | 0.2     | 用于unroll的内存占Storage内存的比例        |
| spark.storage.safetyFraction | 0.9     | Storage内存的安全比例(预留部分内存防止OOM) |

```scala
  private def getMaxStorageMemory(conf: SparkConf): Long = {
    val systemMaxMemory = conf.getLong("spark.testing.memory", Runtime.getRuntime.maxMemory)
    val memoryFraction = conf.getDouble("spark.storage.memoryFraction", 0.6)
    val safetyFraction = conf.getDouble("spark.storage.safetyFraction", 0.9)
    (systemMaxMemory * memoryFraction * safetyFraction).toLong
  }
```

计算方式：maxOnHeapStorageMemory = systemMaxMemory \* memoryFraction \* safetyFraction

如JVM最大堆内内存是1G，默认分配0.6给Storage使用，则StorageMemory为600M，由于要预留部分内存防止OOM，所以实际StorageMemory为1024 \* 0.6 \* 0.9=552.96M，其中用于unroll的内存为552.96 \* 0.2=110.592M。

### maxOnHeapExecutionMemory

| Property Name                | Deault | Meaning                                      |
| ---------------------------- | ------ | -------------------------------------------- |
| spark.shuffle.memoryFraction | 0.2    | Execution内存占系统内存的比例                |
| spark.shuffle.safetyFraction | 0.8    | Execution内存的安全比例(预留部分内存防止OOM) |

```scala
  private def getMaxExecutionMemory(conf: SparkConf): Long = {
    val systemMaxMemory = conf.getLong("spark.testing.memory", Runtime.getRuntime.maxMemory)
		// 省略无关代码
    val memoryFraction = conf.getDouble("spark.shuffle.memoryFraction", 0.2)
    val safetyFraction = conf.getDouble("spark.shuffle.safetyFraction", 0.8)
    (systemMaxMemory * memoryFraction * safetyFraction).toLong
  }
```

计算方式：maxOnHeapExecutionMemory = systemMaxMemory \* memoryFraction \* safetyFraction

如JVM最大堆内内存是1G，默认分配0.2给Execution使用，则ExecutionMemory为200M，由于要预留部分内存防止OOM，则实际ExecutionMemory为1024 \* 0.2 \* 0.8=163.84M。

### 安全比例

安全比例设置的原因：

* spark中对象可以序列化存储与非序列化存储，序列化对象可以通过字节流长度精确计算内存占用大小，非序列化对象的内存占用只能估算，误差可能非常大，有引起OOM的风险。
* MemoryManager申请的内存可能未分配，而标记需要释放的内存可能未被JVM实际GC掉，存在滞后性，Spark不能准确跟踪堆内内存的占用量，为了避免因此发生的OOM，就设置安全区域进行缓冲。

## UnifiedMemoryManager

在1.6版本之后，Spark引入了UnifiedMemoryManager。在UnifiedMemoryManager的管理下，计算和存储内存共享一块内存池，将堆内内存当做一个整体来看待，当需要的时候，彼此借用对方的空闲的内存空间。

![UnifiedMemoryManager](UnifiedMemoryManager.png)

```scala
private[spark] class UnifiedMemoryManager private[memory] (
    conf: SparkConf,
    val maxHeapMemory: Long,
    onHeapStorageRegionSize: Long,
    numCores: Int)
  extends MemoryManager(
    conf,
    numCores,
    onHeapStorageRegionSize,
    // 总内存大小减去Storage的就是Execution的内存
    maxHeapMemory - onHeapStorageRegionSize) {
```

| 属性                        | 解释                                                         |
| --------------------------- | ------------------------------------------------------------ |
| **conf**                    | 即SparkConf。此构造器属性用于父类MemoryManager的构造器属性--conf。 |
| **maxHeapMemory**           | 最大堆内内存，即分配给Driver或Executor的(systemMemory-reservedMemory) * spark.memory.Fraction。 |
| **onHeapStorageRegionSize** | 用于存储的堆内内存大小，用于父类MemoryManager的onHeapStorageMemory构造器属性。由于UnifiedMemory构造器属性中没有onHeapExecutionMemory，所以maxHeapMemory-onHeapStorageRegionSize就是**onHeapExecutionMemory**。 |
| **numCores**                | CPU内核数。                                                  |

### 相关参数

| Property Name                | Default | Meaning                                                      |
| ---------------------------- | ------- | ------------------------------------------------------------ |
| spark.memory.fraction        | 0.6     | 默认将60%的可用内存分配给计算与存储                          |
| spark.memory.storageFraction | 0.5     | 在上述分配到的60%可用内存当中，计算与存储各占一半            |
| spark.memory.offHeap.enabled | false   | 堆外内存默认关闭，如果需要开启，则必须制定spark.memory.offHeap.size并保证其大于0 |
| spark.memory.offHeap.size    | 0       | 堆外内存大小                                                 |

```scala
// 默认的预留内存大小为300M
private val RESERVED_SYSTEM_MEMORY_BYTES = 300 * 1024 * 1024
```

根据图与参数的解释，因为堆外内存默认关闭，这里只考虑堆内内存，计算方式为: 

(maxMemory - reservedMemory) \* spark.memory.fraction

如JVM的内存为1G，则可用的堆内内存为(1024-300)\*0.6=434M，

### Storage相关方法

#### maxOnHeapStorageMemory

返回用于存储的最大堆内内存。

* 最大堆内内存 - 用于计算的堆内内存池中已经使用的内存。
* 即只要计算内存没有使用的或空闲的内存，都可以被存储借用，作为当前内存管理器用于存储的部分。

```scala
  override def maxOnHeapStorageMemory: Long = synchronized {
    maxHeapMemory - onHeapExecutionMemoryPool.memoryUsed
  }
```

#### maxOffHeapStorageMemory

返回用于存储的最大堆外内存。

* 此方法说明，堆外内存中，计算与存储也是可以相互借用的。

```scala
  override def maxOffHeapStorageMemory: Long = synchronized {
    maxOffHeapMemory - offHeapExecutionMemoryPool.memoryUsed
  }
```

#### acquireStorageMemory

为blockId对应的Block，从堆内内存或堆外内存获取numBytes大小的内存。

1. 根据MemoryMode，获取执行内存池，存储内存池，以及可以存储的最大内存空间。
2. 对要获取的内存进行校验，numBytes不能大于可以存储的最大空间。
3. 如果要获取的内存比存储内存池的空闲空间要大，就借用执行内存池的空间，借用的内存大小在numBytes与计算内存池空间空间之间取最小值。

要注意，Storage内存不足是直接根据需要借用的内存大小调整Execution和Storage内存池大小，但是这里并没有定义驱逐Execution内存的逻辑，也就说明了，Storage多占用的内存是可以被Execution驱逐的，但是Execution多占用的内存则不能被Storage驱逐，必须等待Execution自行释放。


```scala
  override def acquireStorageMemory(
      blockId: BlockId,
      numBytes: Long,
      memoryMode: MemoryMode): Boolean = synchronized {
    assertInvariants()
    assert(numBytes >= 0)
    // 根据内存模式获取计算内存池，存储内存池以及最大内存空间。
    val (executionPool, storagePool, maxMemory) = memoryMode match {
      case MemoryMode.ON_HEAP => (
        onHeapExecutionMemoryPool,
        onHeapStorageMemoryPool,
        maxOnHeapStorageMemory)
      case MemoryMode.OFF_HEAP => (
        offHeapExecutionMemoryPool,
        offHeapStorageMemoryPool,
        maxOffHeapStorageMemory)
    }
    if (numBytes > maxMemory) {
      // 校验要申请的内存大小，不能大于最大存储空间
      logInfo(s"Will not store $blockId as the required space ($numBytes bytes) exceeds our " +
        s"memory limit ($maxMemory bytes)")
      return false
    }
    if (numBytes > storagePool.memoryFree) {
      // 如果存储内存池的空闲空间不足，就去计算内存池里借用
      // 大小在numBytes和存储内存池空闲空间中取最小值
      val memoryBorrowedFromExecution = Math.min(executionPool.memoryFree,
        numBytes - storagePool.memoryFree)
      executionPool.decrementPoolSize(memoryBorrowedFromExecution)
      storagePool.incrementPoolSize(memoryBorrowedFromExecution)
    }
    storagePool.acquireMemory(blockId, numBytes)
  }
```

### Execution相关方法

#### acquireExecutionMemory

首先根据堆内堆外获取到对应的内存池对象，这里再次说明了MemoryManager对内存的操作实际上通过内存池来实现。

```scala
  override private[memory] def acquireExecutionMemory(
      numBytes: Long,
      taskAttemptId: Long,
      memoryMode: MemoryMode): Long = synchronized {
    assertInvariants()
    assert(numBytes >= 0)
    val (executionPool, storagePool, storageRegionSize, maxMemory) = memoryMode match {
      // 如果是堆内内存，获取堆内内存池的相关引用
      case MemoryMode.ON_HEAP => (
        onHeapExecutionMemoryPool,
        onHeapStorageMemoryPool,
        onHeapStorageRegionSize,
        maxHeapMemory)
      // 如果是堆外内存，获取堆外内存池的相关引用
      case MemoryMode.OFF_HEAP => (
        offHeapExecutionMemoryPool,
        offHeapStorageMemoryPool,
        offHeapStorageMemory,
        maxOffHeapMemory)
    }
```

#### 内存借用(borrow)与回收(reclaim)逻辑详解

1. Storage和Execution共享同一块内存，任何一方内存不足都可以"占用"另一方。
2. Storage"占用"Execution的内存，当Execution内存不足的时候，可以要求Storage驱逐缓存的Block，从而缩小Storage内存池，释放空间，"回收"内存给Execution。
3. Execution"占用"Storage的内存，当Storage内存不足的时候，只能等待Execution释放它"占用"的内存，因为Storage存储的block数据可以轻易地持久化到磁盘，但是Execution缓存的大多是中间数据(如Shuffle数据)，丢失则会导致任务失败。

![Eviction](Eviction.png)

#### 内嵌方法-maybeGrowExecutionPool (Execution借用Storage内存的关键实现)

acquireExecutionMemory中定义了一个重要的内部方法，**maybeGrowExecutionPool**。
当Execution内存不足的时候，通过驱逐Storage内存中缓存的block，缩小Storage内存池大小，回收内存给Execution，最终达到增大Execution内存池的目的。

```scala
    def maybeGrowExecutionPool(extraMemoryNeeded: Long): Unit = {
      if (extraMemoryNeeded > 0) {
        // 任何Storage内存池中的空闲内存都可以被"回收"，提供给Execution使用。
        // 如果Storage内存池(storagePool.poolSize)已经比它原本大小(storageRegionSize)要大，说明他占用了Execution的内存空间，此时可以驱逐Storage中缓存的block，"回收"内存给Execution使用。
        val memoryReclaimableFromStorage = math.max(
          storagePool.memoryFree,
          storagePool.poolSize - storageRegionSize)
        if (memoryReclaimableFromStorage > 0) {
          // 如果有可以被"回收"利用的内存，返回它的大小
          val spaceToReclaim = storagePool.freeSpaceToShrinkPool(
            math.min(extraMemoryNeeded, memoryReclaimableFromStorage))
            // 缩小Storage存储内存池大小，扩大Execution内存池大小。
          storagePool.decrementPoolSize(spaceToReclaim)
          executionPool.incrementPoolSize(spaceToReclaim)
        }
      }
    }
```

#### 内嵌方法-computeMaxExecutionPoolSize

在"回收"Storage内存后，Execution内存池将会获得的内存大小。

* 实际上最终调用的就是executionPool的**acquireMemory**的方法
* 内嵌方法**maybeGrowExecutionPool**与**computeMaxExecutionPoolSize**都将作为acquireMemory的**入参**。

```scala
    def computeMaxExecutionPoolSize(): Long = {
      maxMemory - math.min(storagePool.memoryUsed, storageRegionSize)
    }
    executionPool.acquireMemory(
      numBytes, taskAttemptId, maybeGrowExecutionPool, () => computeMaxExecutionPoolSize)
```

#### 执行流程

所以acquireExecutionMemory的<u>**执行流程**</u>为：

1. 根据**MemoryMode**获取**UnifiedMemoryManager**管理的堆内或堆外的：

* 执行内存池-**executionPool**，即on/offHeapExecutionMemoryPool
* 存储内存池-**storagePool**，即on/offHeapStorageMemoryPool
* 存储区域大小-**storageRegionSize**，即onHeapStorageRegionSize
* 内存最大值-**maxMemory**，即maxHeapMemory或maxOffHeapMemory

2. 调用ExecutionMemoryPool的acquireMemory方法，为taskAttemptId对应的任务尝试获取numBytes大小的内存。内嵌方法**maybeGrowExecutionPool**与**computeMaxExecutionPoolSize**将作为<u>**函数参数**</u>传入acquireMemory方法中。

## 总结

* 静态内存管理(StaticMemoryManager)通过参数指定的方式确定Storage和Execution分配到JVM的内存大小，两者固定，互不共享。
* 动态内存管理(UnifiedMemoryManager)实现Storage和Execution两者内存共享，在一方不足时可向另一方借用。
* Storage多占用的内存可以被Execution所驱逐(Evict)，但是Execution多占用的内存只能等待其自行释放。
* 两者对内存的操作，都是通过增减对应的内存池大小来实现的。

