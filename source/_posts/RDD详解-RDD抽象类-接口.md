---
title: 'RDD详解[RDD抽象类][接口]'
date: 2020-04-12 22:30:45
tags:
---

![[RDD抽象类][接口]]([RDD抽象类][接口].png)
RDD抽象类内容较多，这里选择分类进行解析。首先是接口，RDD抽象类定义了4个接口，**compute**,**getPartitions**,**getDependencies**,**getPreferredLocations**，分别用于**计算RDD分区**，**获取RDD分区**，**获取RDD依赖**，**获取分区偏好位置**。除getPreferredLocations外，皆由子类进行实现。

## **compute**

**对RDD的分区进行计算**
*"由子类实现 计算所提供的分区"*

```scala
/** 
* :: DeveloperApi :: 
* Implemented by subclasses to compute a given partition.
*/
@DeveloperApi
def compute(split: Partition, context: TaskContext): Iterator[T]
```

## **getPartitions**

**获取当前RDD的所有分区**
"由子类实现 返回该RDD的所有分区的数组"

```scala
/* Implemented by subclasses to return the set of partitions in this RDD. */
protected def getPartitions: Array[Partition]
```

## **getDependencies**

**返回当前RDD的所有依赖**

```scala
/* Implemented by subclasses to return how this RDD depends on parent RDDs.*/
protected def getDependencies: Seq[Dependency[_]] = deps
```

## **getPreferredLocations**

**获取某一分区的偏好位置**
"(可选)可由子类重写 指明优先选取的位置"

```scala
  /*Optionally overridden by subclasses to specify placement preferences.*/
  protected def getPreferredLocations(split: Partition): Seq[String] = Nil
```
