---
title: 'Spark Core [源码解析] MemoryStore(2)'
date: 2020-05-16 00:50:49
tags:
---

## 概述

* 本章将会针对将Block数据存储进内存的方法与过程进行详细讲解。
* 本章将重点关注**putIterator**方法，该方法真正实现了将大型Block数据写入内存的操作，即为了防止一次性写入Block数据造成**OOM**而使用的逐渐展开Block数据的方法。
* 根据序列化与反序列化的数据而定义的**putIteratorAsBytes**和**putIteratorAsValues**两个方法都将调用**putIterator**方法实现**Block**数据到内存的写入，并根据**putIterator**方法返回的结果类型返回对应的**PartiallySerializedBlock**和**PartiallyUnrolledIterator**，然后进行进一步的展开操作。

<!-- more -->

## MemoryStore方法(Block数据的存储和读取)

### putIterator 

* 个人认为，该方法为MemoryStore最为重要的核心方法之一，它实现了将Block数据存储到内存的过程。即将**BlockId**对应的**Block**(已转化为**Iterator**)写入内存。
* 有时候，需要写入内存的Block很大，一次性写入内存可能会发生**OOM**，为了避免OOM，会将**Block**转换为**Iterator**，然后<u>**渐进式的展开Iterator**</u>，并<u>**周期性的检查**</u>是否有足够的展开内存。(这里周期并不是指时间，而是已经展开的元素的数量。)
* 如果该**Iterator**最后被成功写入内存(**顺利unroll整个Iterator**)，将会调用**MemoryManager**的**acquireStorageMemory**方法<u>**将用于unroll的内存转换为storage内存**</u>。
* **putIteratorAsValues**和**putIteratorAsBytes**都将调用该方法来实现将Block数据写入内存这一目的。

#### 变量解释

由于以下代码非常长且涉及到了诸多变量，此处将做一个宏观解释。

| 变量名                          | 解释                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| **elementsUnrolled**            | 到目前为止，已经展开的元素数量。                             |
| **keepUnrolling**               | MemoryStore是否仍然有足够的内存，以便继续展开Block(即Iterator)。默认为true，即默认是有足够内存用以继续展开。 |
| **initialMemoryThreshold**      | 即unrollMemoryThreshold，每一个task在展开Block之前，所请求的初始内存的大小，默认是1M。(1024\*1024) |
| **memoryCheckPeriod**           | 检查内存是否足够的阀值，此值默认为16，并非指时间，而是已经展开的袁术的数量elementsUnrolled。 |
| **memoryThreshold**             | 当前task用于展开Block所保留的内存。初始值为**initialMemoryThreshold**的值，即1M。 |
| **memoryGrowthFactor**          | 内存不足时，请求增长的因子，默认为1.5。                      |
| **unrollMemoryUsedByThisBlock** | 当前Block已经使用的用于展开的内存大小，初始大小为0。         |
| **values**                      | 即需要被渐进式展开的Block数据，这里已经转换为Iterator类型。  |


#### ValuesHolder

* 顾名思义，该变量用于存储value，即<u>**Iterator中被遍历的元素**</u>。
* 定义了**getBuilder**方法，返回**MemoryEntryBuilder**，该方法返回了**MemoryEntryBuilder**，它将会创建**MemoryEntry**并获取存储的数据。
* 注意，在调用了**getBuilder**方法后，**ValuesHolder**将变为<u>**不可用**</u>，不能再继续存储数据和测量数据大小。

```scala
private trait ValuesHolder[T] {
  def storeValue(value: T): Unit
  def estimatedSize(): Long
   // 在getBuilder方法被调用之后，ValuesHolder将变为不可用，不能再继续存储数据和测量数据大小。与此同时，该方法返回了MemoryEntryBuilder，它将会创建MemoryEntry并获取存储的数据。
  def getBuilder(): MemoryEntryBuilder[T]
}
```

#### DeserializedValuesHolder

* 该方法继承了**ValuesHolder**特质，用来存储反序列化的**values**。
* **vector**变量是**DeserializedValuesHolder**的重点变量，实际上就是通过vector来进行values的存储的。
* **vector**实际上是**SizeTrackingVector**，是以**append**方式，跟踪记录它**估算**的字节大小。

```scala
private class DeserializedValuesHolder[T] (classTag: ClassTag[T]) extends ValuesHolder[T] {
  // Underlying vector for unrolling the block
  var vector = new SizeTrackingVector[T]()(classTag)
  var arrayValues: Array[T] = null

  override def storeValue(value: T): Unit = {
  // 在vector上追加value
    vector += value
  }
// 重载估算大小的方法，实际上调用的就是vector.estimateSize
  override def estimatedSize(): Long = {
    vector.estimateSize()
  }
// getBuilder方法用于获取MemoryEntryBuilder，后者用于创建对应MemoryMode的MemoryEntry
  override def getBuilder(): MemoryEntryBuilder[T] = new MemoryEntryBuilder[T] {
    // We successfully unrolled the entirety of this block
    arrayValues = vector.toArray
    vector = null
    
    override val preciseSize: Long = SizeEstimator.estimate(arrayValues)

    override def build(): MemoryEntry[T] =
    // 可以看到实际上实例化了DeserializedMemoryEntry
      DeserializedMemoryEntry[T](arrayValues, preciseSize, classTag)
  }
}
```

##### MemoryEntryBuilder

* 紧跟**ValuesHolder**方法，**MemoryEntryBuilder**方法定义了**build**方法，最终将返回**MemoryEntry**
* 所以<u>**Block在内存中的抽象MemoryEntry其实是在这里被创建的**</u>。

```scala
private trait MemoryEntryBuilder[T] {
  def preciseSize: Long
  def build(): MemoryEntry[T]
}
```


#### 源码解析

在了解了基本的变量含义用途，以及两个关键的特质**ValuesHolder**，**MemoryEntryBuilder**后，我们直接开始看**putIterator**方法。


```scala
 // 首先注意，如果展开block成功，会直接返回存储该block数据所占用的内存大小值。
 // 如果失败，返回展开该block所占用的大小，有两种可能的原因
 // 1. block(即Iterator)只有部分被展开(未完全展开)
 // 2. block已经被完全展开但是其最后实际所占用的展开内存过大，我们无法申请到额外的内存进行存储。
  private def putIterator[T](
      blockId: BlockId,
      values: Iterator[T],
      classTag: ClassTag[T],
      memoryMode: MemoryMode,
      valuesHolder: ValuesHolder[T]): Either[Long, Long] = {
    require(!contains(blockId), s"Block $blockId is already present in the MemoryStore")

    // 到目前为止，已经展开的元素数量。
    var elementsUnrolled = 0
    // MemoryStore是否仍然有足够的内存，以便继续展开Block(即Iterator)。
    var keepUnrolling = true
    // 即unrollMemoryThreshold，每一个task在展开Block之前，所请求的初始内存的大小，默认是1M。(1024*1024)
    val initialMemoryThreshold = unrollMemoryThreshold
    // 检查内存是否足够的阀值，此值默认为16，并非指时间，而是已经展开的袁术的数量elementsUnrolled。
    val memoryCheckPeriod = conf.get(UNROLL_MEMORY_CHECK_PERIOD)
    // 当前task用于展开Block所保留的内存。初始值为**initialMemoryThreshold**的值，即1M。
    var memoryThreshold = initialMemoryThreshold
    // 内存不足时，请求增长的因子，默认为1.5。
    val memoryGrowthFactor = conf.get(UNROLL_MEMORY_GROWTH_FACTOR)
    // 当前Block已经使用的用于展开的内存大小，初始大小为0.
    var unrollMemoryUsedByThisBlock = 0L

    // 首先调用reserveUnrollMemoryForThisTask为该任务在堆内或堆外中展开block申请需要的内存
    // 可以看到，初始申请的内存为initailMemoryThreshold即1M。
    keepUnrolling =
      reserveUnrollMemoryForThisTask(blockId, initialMemoryThreshold, memoryMode)
    // 因为实质调用的是memoryManager.acquireUnrollMemory，返回Boolean
    // 没有申请到，直接WARNING
    if (!keepUnrolling) {
      logWarning(s"Failed to reserve initial memory threshold of " +
        s"${Utils.bytesToString(initialMemoryThreshold)} for computing block $blockId in memory.")
    } else {
    // 若申请成功，直接将申请到的内存添加到当前Block已经使用的展开内存大小。
      unrollMemoryUsedByThisBlock += initialMemoryThreshold
    }

    // Unroll this block safely, checking whether we have exceeded our threshold periodically
    // 不断的循环，values即Iterator中是否还有未被展开的元素，如果有的话，是否还能够为当前任务线程在堆内或堆外获取到所需要大小的内存。
    while (values.hasNext && keepUnrolling) {
    // 如果都满足，调用valuesHolder.storeValue存储Iterator的元素。
      valuesHolder.storeValue(values.next())
      // 取模运算，若当前已经展开的元素数量elementsUnrolled 与 memoryCheckPeriod(默认每16个元素检查一次) 相除余数为0
      // 这里需要耐心理解，这里两者相除余数为0，意味着当前已经展开的元素数量，刚好是我们规定的检查周期的倍数，意味着到了需要检查当前已经展开的数据所占用的内存(currentSize)是否已经超过了我们设置的阀值(memoryThreshold)。
      if (elementsUnrolled % memoryCheckPeriod == 0) {
        val currentSize = valuesHolder.estimatedSize()
        // 如果当前展开的数据所占用的内存已经超过阀值，则按照公式计算需要申请增加的内存。
        // 需要申请增加内存 = 当前展开占用内存 * 内存增长因子 - 当前阀值
        if (currentSize >= memoryThreshold) {
          val amountToRequest = (currentSize * memoryGrowthFactor - memoryThreshold).toLong
          // 得到需要申请增加的内存大小后，直接调用reserveUnrollMemoryForThisTask方法为当前任务尝试线程申请内存。
          keepUnrolling =
            reserveUnrollMemoryForThisTask(blockId, amountToRequest, memoryMode)
            // 如果申请成功，当前Block展开所消耗的内存总量随之递增相应大小。
          if (keepUnrolling) {
            unrollMemoryUsedByThisBlock += amountToRequest
          }
          // New threshold is currentSize * memoryGrowthFactor
          // 这里可以发现阀值是动态变化的，随着每一次申请新内存而增加
          // 公式为 新阀值 = 当前展开占用内存 * 内存增长因子
          memoryThreshold += amountToRequest
        }
      }
      // 若取模运算结果不为0，说明还没有到检查内存是否足够的周期检查点，
      // 直接将到目前为止展开的元素总数自增1即可。
      elementsUnrolled += 1
    }

    // Make sure that we have enough memory to store the block. By this point, it is possible that
    // the block's actual memory usage has exceeded the unroll memory by a small amount, so we
    // perform one final call to attempt to allocate additional memory if necessary.
    // 为了确保我们有足够的内存去存储当前Block(即Iterator)
    // 在while循环结束这个时间点，当前Block实际上占用的内存可能比我们记录在案的当前Block已经使用的内存unrollMemoryUsedByThisBlock要多。
    // 可以这么理解，即while循环结束的时候，其迭代次数并没有达到我们设定的检查点memoryCheckPeriod，但是又超过了上次的检查点memoryCheckPeriod，这就导致新展开的element直接被加入了valuesHolder，却没有检查到底剩余空间是否足够。
    // 所以这里将做最后一次的内存申请，保证最终一定有足够的内存存储该Block。
    if (keepUnrolling) {
    // 这里直接调用getBuilder方法，创建MemoryEntryBuilder。
      val entryBuilder = valuesHolder.getBuilder()
      // 然后调用preciseSize方法获取其大小，即实际上占用的内存空间。
      val size = entryBuilder.preciseSize
      // 如果实际上占用的空间size，比记录在案的当前Block所占用的内存空间unrollMemoryUsedByThisBlock大
      if (size > unrollMemoryUsedByThisBlock) {
      // 即内存不足了，需要申请，申请大小就是超出的内存大小。
        val amountToRequest = size - unrollMemoryUsedByThisBlock
        // 最后一次调用reserveUnrollMemoryForThisTask为当前任务线程申请内存
        keepUnrolling = reserveUnrollMemoryForThisTask(blockId, amountToRequest, memoryMode)
        // 如果申请成功，最后将申请到的内存累加到Block所占用的内存空间上。
        if (keepUnrolling) {
          unrollMemoryUsedByThisBlock += amountToRequest
        }
      }
      // 如果上面申请内存成功
      if (keepUnrolling) {
      // 创建MemoryEntry，所以Block在Memory中的抽象MemoryEntry是在这里创建的。
        val entry = entryBuilder.build()
        // Synchronize so that transfer is atomic
        memoryManager.synchronized {
        // 释放当前任务线程所占用的内存
          releaseUnrollMemoryForThisTask(memoryMode, unrollMemoryUsedByThisBlock)
          // 直接调用MemoryManager.acquireStorageMemory为当前blockId对应的Block申请其实际占用的内存(entry.size)。
          // 可以理解为这里是将展开内存unroll memory转换为存储内存storage memory。
          val success = memoryManager.acquireStorageMemory(blockId, entry.size, memoryMode)
          assert(success, "transferring unroll memory to storage memory failed")
        }

        entries.synchronized {
        // 将BlockId和MemoryEntry的映射关系添加到entries映射表中
          entries.put(blockId, entry)
        }

        logInfo("Block %s stored as values in memory (estimated size %s, free %s)".format(blockId,
          Utils.bytesToString(entry.size), Utils.bytesToString(maxMemory - blocksMemoryUsed)))
          // 返回Right(实际占用的内存大小)
        Right(entry.size)
      } else {
        // 如果申请内存失败，即内存不足，返回Left(当前Block所占用的展开内存的总大小)
        logUnrollFailureMessage(blockId, entryBuilder.preciseSize)
        Left(unrollMemoryUsedByThisBlock)
      }
    } else {
      // 如果申请内存失败，即内存不足，返回Left(当前Block所占用的展开内存的总大小)
      logUnrollFailureMessage(blockId, valuesHolder.estimatedSize())
      Left(unrollMemoryUsedByThisBlock)
    }
  }
```

### putIteratorAsValues

* 尝试以**value**的形式存储**bock**(即**Iterator**)数据
* 如果展开**Iterator**成功，返回存储展开该**block**数据占用的估算内存大小。(堆内内存无法精确得到占用的内存。)
* 如果展开**Iterator**失败，返回包含**block**数据(**values**)的**Iterator**，这里为**PartiallyUnrolledIterator**，即<u>**部分展开**</u>的**Iterator**。

```scala
// 从入参的返回值就可以发现，共两种类型的返回，第一种为PartiallyUnrolledIterator,另一种则是整形(block数据的大小)
  private[storage] def putIteratorAsValues[T](
      blockId: BlockId,
      values: Iterator[T],
      classTag: ClassTag[T]): Either[PartiallyUnrolledIterator[T], Long] = {
// 创建valuesHolder实例，这里为反序列化的valuesHolder
    val valuesHolder = new DeserializedValuesHolder[T](classTag)
// 调用putIterator方法，注意DeserializedValuesHolder所创建的是DeserializedMemoryEntry，只支持ON_HEAP即堆内内存上申请展开内存，所以这里入参直接填写的就是ON_HEAP的MemoryMode
    putIterator(blockId, values, classTag, MemoryMode.ON_HEAP, valuesHolder) match {
    // 如果返回MemoryEntry占用的内存大小，即DeserializedMemoryEntry.size，
    // 说明展开Block(Iterator)成功，直接返回该值即可。
      case Right(storedSize) => Right(storedSize)
      // 如果返回的是已经占用的展开内存大小，即展开Block(Iterator)失败了
      case Left(unrollMemoryUsedByThisBlock) =>
      // 通过判断vector是否为null来返回iterator或者arrayValues
      // 观察DeserializedValuesHolder能够发现，getBuilder方法被成功调用后，vector会被赋值为null，并转化为array。所以如vector非null，即getBuilder方法没有被正常调用。
        val unrolledIterator = if (valuesHolder.vector != null) {
          valuesHolder.vector.iterator
        } else {
          valuesHolder.arrayValues.toIterator
        }
        // 如果展开失败，返回PartiallyUnrolledIterator
        Left(new PartiallyUnrolledIterator(
          this,
          MemoryMode.ON_HEAP,
          unrollMemoryUsedByThisBlock,
          unrolled = unrolledIterator,
          rest = values))
    }
  }
```

#### PartiallyUnrolledIterator

* 当 **MemoryStore.putIteratorAsValues()** 方法执行失败时返回的结果。
* 可以理解为，**PartiallyUnrolledIterator**包含两个核心的**Iterator**,一个叫**unrolled**,内部是<u>**已经被展开**</u>的**Block**数据，另一个叫**rest**，即“其余的”，内部包含的是<u>**未被展开**</u>的**Block**数据。

| 构造参数         | 解释                                                         |
| ---------------- | ------------------------------------------------------------ |
| **memoryStore**  | 当前**MemoryStore**，用于释放已经展开的**values**(即**Iterator**中的元素)所占用的内存 |
| **memoryMode**   | 当前使用的内存模式**ON/OFF_HEAP**                            |
| **unrollMemory** | 已经展开的values所占用的内存(**unrolled**中的**values**所占用的总内存)，即**memoryStore**需要进行释放的内存 |
| **unrolled**     | 一个**iterator**，内部含有<u>**已经被展开**</u>的**values**  |
| **rest**         | 与已经展开的**iterator**区分，**rest**也是一个**iterator**，但是包含的是<u>**未被展开**</u>的**values** |

```scala
private[storage] class PartiallyUnrolledIterator[T](
    memoryStore: MemoryStore,
    memoryMode: MemoryMode,
    unrollMemory: Long,
    private[this] var unrolled: Iterator[T],
    rest: Iterator[T])
  extends Iterator[T] {

  private def releaseUnrollMemory(): Unit = {
  // 一路追溯可以发现这里实际上调用的就是StorageMemoryPool里的releaseMemory()方法进行存储内存的释放
    memoryStore.releaseUnrollMemoryForThisTask(memoryMode, unrollMemory)
    // 成功释放内存后，赋值unrolled迭代器为null
    unrolled = null
  }
// 此处可以理解为，如果unrolled这个包含已经展开的values的iterator(即unrolled)被赋值为null，意味着其占用的内存也被释放，从而有内存空间进行下一波的unroll操作
// 该方法返回布尔值，即是否还有剩余的values等待被unroll
  override def hasNext: Boolean = {
    if (unrolled == null) {
    // 如果unrolled被清空，查看rest(包含未被展开的values的Iterator)是否为空
    // 如果存在未被展开的values，返回true
      rest.hasNext
    } else if (!unrolled.hasNext) {
    // 如果unrolled为空，释放展开block所占用的内存，查看是否有等待展开的values
      releaseUnrollMemory()
      rest.hasNext
    } else {
      true
    }
  }
  override def next(): T = {
    if (unrolled == null || !unrolled.hasNext) {
      rest.next()
    } else {
      unrolled.next()
    }
  }
// 该方法直接释放所有展开Block占用的内存，并销毁该PartiallyUnrolledIterator
  def close(): Unit = {
    if (unrolled != null) {
      releaseUnrollMemory()
    }
  }
}
```

### putIteratorAsBytes

官方对于该方法的几点解释：

* 与**putIteratorAsValues**相对的，**putIteratorAsBytes**方法以**bytes**形式将**Block**数据存储到内存当中。
* 若执行成功，返回展开的**Block**数据所占用的大小。(**Long**)
* 若执行失败，返回**PartiallySerializedBlock[T]** 该实例通过将数据溢出到磁盘来完成序列化，或者反序列化已经部分序列化的**block**数据并重建原始输入的**Iterator**。调用者必须保证该Iterator被完全消费或者调用discard()方法，从而保证部分已经被展开的block所占用的内存被释放掉。

```scala
  private[storage] def putIteratorAsBytes[T](
  // 只有两种类型的返回，PartiallySerializedBlock[T], Long
      blockId: BlockId,
      values: Iterator[T],
      classTag: ClassTag[T],
      memoryMode: MemoryMode): Either[PartiallySerializedBlock[T], Long] = {

    require(!contains(blockId), s"Block $blockId is already present in the MemoryStore")

    // 每个task用于unroll Block数据的初始内存，默认是1M (bytes).
    val initialMemoryThreshold = unrollMemoryThreshold
    val chunkSize = if (initialMemoryThreshold > ByteArrayMethods.MAX_ROUNDED_ARRAY_LENGTH) {
      logWarning(s"Initial memory threshold of ${Utils.bytesToString(initialMemoryThreshold)} " +
        s"is too large to be set as chunk size. Chunk size has been capped to " +
        s"${Utils.bytesToString(ByteArrayMethods.MAX_ROUNDED_ARRAY_LENGTH)}")
      ByteArrayMethods.MAX_ROUNDED_ARRAY_LENGTH
    } else {
      initialMemoryThreshold.toInt
    }
// 创建SerializedValuesHolder，存储的是序列化的数据
    val valuesHolder = new SerializedValuesHolder[T](blockId, chunkSize, classTag,
      memoryMode, serializerManager)
// 调用putIterator方法，对Block数据进行展开
    putIterator(blockId, values, classTag, memoryMode, valuesHolder) match {
    // 老样子，若putIterator返回的是storedSize，即展开成功，直接照着返回即可
      case Right(storedSize) => Right(storedSize)
      // 若返回的是展开的Block所占用的内存，即展开失败
      case Left(unrollMemoryUsedByThisBlock) =>
      // 则返回PartiallySerializedBlock
        Left(new PartiallySerializedBlock(
          this,
          serializerManager,
          blockId,
          valuesHolder.serializationStream,
          valuesHolder.redirectableStream,
          unrollMemoryUsedByThisBlock,
          memoryMode,
          valuesHolder.bbos,
          values,
          classTag))
    }
  }
```

#### PartiallySerializedBlock

* MemoryStore.putIteratorAsBytes 执行失败的返回结果。
* 重点之一**serializationStream**和**redirectableOutputStream**，前者用于向后者写入序列化数据。
* 重点之二**bbos**即byte buffer output stream,类型为**ChunkedByteBufferOutputStream**，变量**unrolledBuffer**返回的就是bbos转化的**ChunkedByteBuffer**。

构造函数入参一览：

| 构造参数                     | 解释                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| **memoryStore**              | 当前memoryStore，用于释放内存                                |
| **serializerManager**        | 序列化管理器，用于反序列化values                             |
| **blockId**                  | 当前block id                                                 |
| **serializationStream**      | 序列化流，用于向redirectableOutputStream写入数据             |
| **redirectableOutputStream** | 支持重定向的输出流                                           |
| **unrollMemory**             | 已经展开的数据占用的内存大小，即unrolled内元素占用的总内存大小 |
| **memoryMode**               | ON/OFF_HEAP                                                  |
| **bbos**                     | byte buffer output stream缩写，即包含部分序列化values的输出字节流；**redirectableOutputStream**初始化时默认写入该输出流(可被重定向) |
| **rest**                     | 原始Iterator，在去除该序列化部分后，剩余的将要交给**putIteratorAsValues()** 的部分 |
| **classTag**                 | block类型标识                                                |


```scala
private[storage] class PartiallySerializedBlock[T](
    memoryStore: MemoryStore,
    serializerManager: SerializerManager,
    blockId: BlockId,
    private val serializationStream: SerializationStream,
    private val redirectableOutputStream: RedirectableOutputStream,
    val unrollMemory: Long,
    memoryMode: MemoryMode,
    bbos: ChunkedByteBufferOutputStream,
    rest: Iterator[T],
    classTag: ClassTag[T]) {
// 这里可以看到，unrolledBuffer就是bbos转化为ChunkedByteBuffer
  private lazy val unrolledBuffer: ChunkedByteBuffer = {
    bbos.close()
    bbos.toChunkedByteBuffer
  }
  Option(TaskContext.get()).foreach { taskContext =>
    taskContext.addTaskCompletionListener[Unit] { _ =>
      // 当一个task执行完毕，它所占用的unroll memory会被自动释放，所以这里避免内存的重复释放，就没有调用releaseUnrollMemoryForThisTask方法了。
      unrolledBuffer.dispose()
    }
  }
  // 获取bbos转化的ChunkedByteBuffer
  private[storage] def getUnrolledChunkedByteBuffer: ChunkedByteBuffer = unrolledBuffer
// 是否被丢弃，用discard表示，默认未被丢弃
  private[this] var discarded = false
  // 是否被完全消费，用consumed表示，默认未被完全消费
  private[this] var consumed = false
// 根据以上两者抛出相应异常
  private def verifyNotConsumedAndNotDiscarded(): Unit = {
    if (consumed) {
      throw new IllegalStateException(
        "Can only call one of finishWritingToStream() or valuesIterator() and can only call once.")
    }
    if (discarded) {
      throw new IllegalStateException("Cannot call methods on a discarded PartiallySerializedBlock")
    }
  }
```

## 总结

1. **putIterator**实现了将**block**数据以**bytes**或**values**的形式存储到内存当中。
2. **valuesHolder**定义的**getBuilder**方法将获取**MemoryEntryBuilder**，而**MemoryEntryBuilder**将会调用**build**方法根据**Serialized**/**Deserialzed**来创建对应的**MemoryEntry**，用于存储**block**的数据。
3. 根据**Serialized**/**Deserialzed**不同的数据类型，将分别调用**putIteratorAsBytes**/**putIteratorAsValues**对block进行展开，其核心都是调用**putIIterator**方法。
4. 若展开成功，则返回存储block数据的大小(**storedSize**)，若展开失败，则分别返回**PartiallyUnrolledIterator(values)/PartiallySerializedBlock(bytes)。**

