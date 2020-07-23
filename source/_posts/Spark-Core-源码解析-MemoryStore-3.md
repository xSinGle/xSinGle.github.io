---
title: Spark Core [源码解析] MemoryStore(3)
date: 2020-05-16 01:18:20
tags:
---
## 概述

本章将讲解剩余的用于处理Block数据方法，包括但不限于以下方法：

* 直接在内存中写入/读取Block数据 (**putBytes**/**getBytes**)
* 查询Block数据大小 (**getSize**)
* 检测Block文件是否存在 (**contains**)
* 将Block从内存中驱逐等方法 (**evictBlocksToFreeSpace**)

> 需要重点关注**evictBlocksToFreeSpace**方法中，**Block**被驱逐的具体条件，只有满足条件的**Block**才可以被**evict**。

<!-- more -->

## getSize

> 该方法通过**BlockId**在**entries**映射表中获取对应的**MemoryEntry**所占用的内存大小。

```scala
  def getSize(blockId: BlockId): Long = {
    entries.synchronized {
      entries.get(blockId).size
    }
  }
```

## putBytes

> 此方法将**BlockId**对应的**Block**(已经封装为**ChunkedByteBuffer**)写入内存。

```scala
  def putBytes[T: ClassTag](
      blockId: BlockId,
      size: Long,
      memoryMode: MemoryMode,
      _bytes: () => ChunkedByteBuffer): Boolean = {
    require(!contains(blockId), s"Block $blockId is already present in the MemoryStore")
    if (memoryManager.acquireStorageMemory(blockId, size, memoryMode)) {
      // 从MemoryManager中获取到存储该Block数据需要的内存后，继续下一步
      // 调用_bytes方法获取到Block数据，即ChunkedByteBuffer
      val bytes = _bytes()
      assert(bytes.size == size)
      // 创建SerializedMemoryEntry
      val entry = new SerializedMemoryEntry[T](bytes, memoryMode, implicitly[ClassTag[T]])
      entries.synchronized {
      // 将SerializedMemoryEntry放入内存(添加入entries映射表)
        entries.put(blockId, entry)
      }
      logInfo("Block %s stored as bytes in memory (estimated size %s, free %s)".format(
        blockId, Utils.bytesToString(size), Utils.bytesToString(maxMemory - blocksMemoryUsed)))
      true
    } else {
      false
    }
  }
```

**执行流程：**

1. 调用**MemoryManager**的**acquireStorageMemory**方法获取用于存储**BlockId**对应的**Block**的逻辑内存。如果获取成功则继续，获取失败直接返回false。
2. 调用 **\_bytes** 方法获取**Block**的数据，即**ChunkedByteBuffer**。
3. 创建**SerializedMemoryEntry**。
4. 将**SerializedMemoryEntry**放入**entries**缓存。
5. 返回true。


## getBytes

> 此方法从内存中读取BlockId对应的Block(已经被封装为**ChunckedByteBuffer**)数据。根据代码可知，只支持获取<u>**序列化**</u>的Block。(字节化的Block)

```scala
  def getBytes(blockId: BlockId): Option[ChunkedByteBuffer] = {
    val entry = entries.synchronized { entries.get(blockId) }
    entry match {
    // 如果内存中的entires映射表中没有该Block，直接返回None
      case null => None
      // 如果发现是DeserializedMemoryEntry，报错，只能获取序列化的Block
      case e: DeserializedMemoryEntry[_] =>
        throw new IllegalArgumentException("should only call getBytes on serialized blocks")
        // 如果是SerializedMemoryEntry，返回其包含的Block数据
      case SerializedMemoryEntry(bytes, _, _) => Some(bytes)
    }
  }
```

## getValues

> 与getBytes相比，该方法用于从内存中获取迭代器化的Block数据(**Iterator**)。根据代码可知，只支持获取<u>**反序列化**</u>的Block数据。

```scala
  def getValues(blockId: BlockId): Option[Iterator[_]] = {
    val entry = entries.synchronized { entries.get(blockId) }
    entry match {
    // 如果内存中的entires映射表中没有该Block，直接返回None
      case null => None
      // 如果是序列化的MemoryEntry，直接抛出异常
      case e: SerializedMemoryEntry[_] =>
        throw new IllegalArgumentException("should only call getValues on deserialized blocks")
        // 如果实序列化的MemoryEntry，返回其包含的数据
      case DeserializedMemoryEntry(values, _, _) =>
        val x = Some(values)
        x.map(_.iterator)
    }
  }
```

## remove

> 此方法用于从内存中移除BlockId对应的Block。

1. 将BlockId对应的MemoryEntry从entries中移除，如果entries中存在BlockId对应的MemoryEntry，进入第二步，否则返回**false**。
2. 如果MemoryEntry是**SerializedMemoryEntry**，还要将对应的**ChunkedByteBuffer**清理。
3. 调用**MemoryManager**的**releaseStorageMemory**方法，释放使用的存储内存。
4. 返回**true**。

```scala
  def remove(blockId: BlockId): Boolean = memoryManager.synchronized {
    val entry = entries.synchronized {
    // 从entries映射表中移除blockId对应的MemoryEntry
      entries.remove(blockId)
    }
    // 如果存在对应的MemoryEntry，且为SerializedMemoryEntry
    // 还需要把ChunkedByteBuffer释放掉
    if (entry != null) {
      entry match {
        case SerializedMemoryEntry(buffer, _, _) => buffer.dispose()
        case _ =>
      }
      // 调用MemoryManager的releaseStorageMemory释放占用的存储内存
      memoryManager.releaseStorageMemory(entry.size, entry.memoryMode)
      logDebug(s"Block $blockId of size ${entry.size} dropped " +
        s"from memory (free ${maxMemory - blocksMemoryUsed})")
        // 返回true
      true
    } else {
    // 如果不存在对应的MemoryEntry，直接返回false
      false
    }
  }
```


## clear

> 此方法用于清空**MemoryStore**。

```scala
  def clear(): Unit = memoryManager.synchronized {
    entries.synchronized {
    // 清空entries映射表
      entries.clear()
    }
    // 清空taskAttemptId对应的任务尝试线程，与其消耗的总堆内/外内存的映射表
    onHeapUnrollMemoryMap.clear()
    offHeapUnrollMemoryMap.clear()
    // 最后调用MemoryManager的releaseAllStorageMemory方法释放占用的存储内存
    memoryManager.releaseAllStorageMemory()
    logInfo("MemoryStore cleared")
  }
```

## evictBlocksToFreeSpace

> 此方法用于驱逐Block，从而释放一定大小的内存空间用于存储新的Block。

| 局部变量           | 解释                                                        |
| ------------------ | ----------------------------------------------------------- |
| **blockId**        | 我们将要存储的新的Block的BlockId。(驱逐Block就是为了存储它) |
| **space**          | 存储新的Block所需要的内存空间大小。                         |
| **memoryMode**     | 存储Block所需要的内存模式。                                 |
| **freedMemory**    | 已经释放的内存大小。                                        |
| **rddToAdd**       | 将要添加的RDD的RDDBlockId标记。                             |
| **selectedBlocks** | 已经被选出的将要被驱逐的Block的BlockId的数组。              |


1. 当freedMemory值小于space值的时候，不断迭代遍历iterator。对于每个entries中的**BlockId**和**MemoryEntry**，首先找出符合条件的Block，然后获取Block写锁，最后将此Block的BlockId放入**selectedBlocks**并且将**freedMemory**增加Block的大小。

满足<u>**两个条件**</u>的Block将会<u>**被驱逐**</u>：

* **MemoryEntry**的内存模式与存储新**Block**所需的内存模式一致。
* **BlockId**对应的**Block**不是**RDD**，或者**BlockId**与**blockId**不是同一个**RDD**。

接下来的两步，其实就是根据**freedMemory**和**space**，即驱逐满足条件的Block后所释放的内存空间与存储新Block所需要的内存空间之间的对比，来决定下一步操作。

2. 第1步完成处理后，如果**freedMemory**<u>大于等于</u>**space**，说明通过驱逐一定数量的Block，已经为存储blockId对应的Block腾出了<u>**足够的内存空间**</u>，此时需要遍历**selectedBlocks**中的每个**BlockId**，并<u>**移除**</u>每个**BlockId**对应的**Block**。如果Block从内存中迁移到其他存储(如DiskStore)中，需要调用BlockInfoManager的**unlock**释放当前任务尝试线程获取的被迁移Block的写锁。如果Block从存储体系中彻底移除了，那么需要调用**BlockInfoManager**的**removeBlock**方法删除被迁移Block的信息。

3. 第1步完成处理后，如果**freedMemory**<u>小于</u>**space**，这说明即便驱逐内存中所有符合条件的Block，腾出的空间也不足以存储blockId对应的Block，此时需要当前任务尝试线程释放**selectedBlocks**中每个BlockId对应的Block的写锁。


有了对驱逐Block整个流程的清晰认识，直接上代码。

```scala
private[spark] def evictBlocksToFreeSpace(
      blockId: Option[BlockId],
      space: Long,
      memoryMode: MemoryMode): Long = {
    assert(space > 0)
    memoryManager.synchronized {
      var freedMemory = 0L
      val rddToAdd = blockId.flatMap(getRddId)
      val selectedBlocks = new ArrayBuffer[BlockId]
      def blockIsEvictable(blockId: BlockId, entry: MemoryEntry[_]): Boolean = {
        entry.memoryMode == memoryMode && (rddToAdd.isEmpty || rddToAdd != getRddId(blockId))
      }
      // This is synchronized to ensure that the set of entries is not changed
      // (because of getValue or getBytes) while traversing the iterator, as that
      // can lead to exceptions.
      entries.synchronized {
        val iterator = entries.entrySet().iterator()
        while (freedMemory < space && iterator.hasNext) {
          val pair = iterator.next()
          val blockId = pair.getKey
          val entry = pair.getValue
          if (blockIsEvictable(blockId, entry)) {
            // We don't want to evict blocks which are currently being read, so we need to obtain
            // an exclusive write lock on blocks which are candidates for eviction. We perform a
            // non-blocking "tryLock" here in order to ignore blocks which are locked for reading:
            if (blockInfoManager.lockForWriting(blockId, blocking = false).isDefined) {
              selectedBlocks += blockId
              freedMemory += pair.getValue.size
            }
          }
        }
      }

      def dropBlock[T](blockId: BlockId, entry: MemoryEntry[T]): Unit = {
        val data = entry match {
          case DeserializedMemoryEntry(values, _, _) => Left(values)
          case SerializedMemoryEntry(buffer, _, _) => Right(buffer)
        }
        val newEffectiveStorageLevel =
        // blockManager实现了dropFromMemory方法
        // 如果StorageLevel允许，会尝试将block写到磁盘上，并返回新的存储级别
          blockEvictionHandler.dropFromMemory(blockId, () => data)(entry.classTag)
        if (newEffectiveStorageLevel.isValid) {
          // The block is still present in at least one store, so release the lock
          // but don't delete the block info
          blockInfoManager.unlock(blockId)
        } else {
          // The block isn't present in any store, so delete the block info so that the
          // block can be stored again
          blockInfoManager.removeBlock(blockId)
        }
      }
// 如果被释放的内存空间大于等于存储新Block所需要的内存空间，即腾出了足够空间
      if (freedMemory >= space) {
        var lastSuccessfulBlock = -1
        try {
          logInfo(s"${selectedBlocks.size} blocks selected for dropping " +
            s"(${Utils.bytesToString(freedMemory)} bytes)")
            // 遍历selectedBlocks这个包含需要被驱逐的Block的Id的数组
          (0 until selectedBlocks.size).foreach { idx =>
          // 从entries中获取对应的BlockId和MemoryEntry
            val blockId = selectedBlocks(idx)
            val entry = entries.synchronized {
              entries.get(blockId)
            }
            // This should never be null as only one task should be dropping
            // blocks and removing entries. However the check is still here for
            // future safety.
            if (entry != null) {
            // 调用dropBlock方法从内存中将其驱逐
              dropBlock(blockId, entry)
              afterDropAction(blockId)
            }
            lastSuccessfulBlock = idx
          }
          logInfo(s"After dropping ${selectedBlocks.size} blocks, " +
            s"free memory is ${Utils.bytesToString(maxMemory - blocksMemoryUsed)}")
            // 最后返回被释放的内存空间大小
          freedMemory
        } finally {
          // like BlockManager.doPut, we use a finally rather than a catch to avoid having to deal
          // with InterruptedException
          if (lastSuccessfulBlock != selectedBlocks.size - 1) {
            // the blocks we didn't process successfully are still locked, so we have to unlock them
            (lastSuccessfulBlock + 1 until selectedBlocks.size).foreach { idx =>
              val blockId = selectedBlocks(idx)
              blockInfoManager.unlock(blockId)
            }
          }
        }
      } else {
        blockId.foreach { id =>
          logInfo(s"Will not store $id")
        }
        selectedBlocks.foreach { id =>
          blockInfoManager.unlock(id)
        }
        0L
      }
    }
  }
```


## contains

> 此方法用于查看**MemoryStore**中是否包含给定**BlockId**所对应的**Block**文件。

```scala
  def contains(blockId: BlockId): Boolean = {
    entries.synchronized { entries.containsKey(blockId) }
  }
```


## 小结

* 本章重点讲解了**evictBlocksToFreeSpace**方法，包括其局部变量以及详细的执行流程。
* 顺便提及了一些较为简单常用的对**Block**在内存中的读写方法，包括**getBytes**, **putBytes**, **getValues**,等等。
* 至此，无论是将Block直接写入内存(**putBytes**)，还是将Block逐渐展开(**putIterator**)并写入内存，亦或是将Block从内存中驱逐(**evictBlocksToFreeSpace**)的重点方法都已详述，务必重点掌握，了然于胸。


