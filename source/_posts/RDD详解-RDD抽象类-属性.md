---
title: RDD详解[RDD抽象类][属性]
date: 2020-04-13 23:53:16
tags: [Spark,RDD] 
---
![[RDD抽象类][属性]]([RDD抽象类][属性].png)

<!-- more -->

对于RDD抽象类属性的简要描述。

**PS: "凡是有@transient修饰的 不会被序列化"**
## **_sc**
**指SparkContext**

```scala
@transient private var _sc: SparkContext
```

sc方法返回_sc 若_sc为null 抛出异常

```scala
private def sc: SparkContext = { 
    if (_sc == null){    
        throw new SparkException("....." )  
    } 
    _sc
}
```

## **deps**
**构造器参数之一，是Dependency的序列，用于存储当前RDD的依赖，RDD的子类实现时不一定会传递此参数**

```scala
@transient private var deps: Seq[Dependency[_]]
```

## **dependencies_**
**与deps相同，但是可以被序列化**

```scala
private var dependencies_ : Seq[Dependency[_]] = _
```

## **partitioner**
**当前RDD的分区计算器**
"可以被子类重写，以决定RDD如何进行分区"

```scala
/** Optionally overridden by subclasses to specify how they are partitioned.*/
@transient val partitioner: Option[Partitioner] = None
```

## **id**
**当前RDD的唯一身份标识，此属性通过SparkContext的nextRddId属性生成**

```scala
/** A unique ID for this RDD (within its SparkContext). */
val id: Int = sc.newRddId()
```

## **name**
**RDD的名称**
"默认为占位符为null 可以调用setName方法修改名称"

```scala
/** A friendly name for this RDD */
@transient var name: String = _
/** Assign a name to this RDD */
def setName(_name: String): this.type = { 
    name = _name  
    this
}
```

## **partitions_**
**存储当前RDD的所有分区的数组**

```scala
@transient private var partitions_ : Array[Partition] = _
```

## **storageLevel**
**当前RDD的存储级别**
"默认是NONE"

```scala
private var storageLevel: StorageLevel = StorageLevel.NONE
```

## **creationSite**
**创建当前RDD的用户代码**
"如调用创建RDD的相关函数代码textFile parallelize等等"

```scala
/** User code that created this RDD (e.g. `textFile`, `parallelize`). */
@transient private[spark] val creationSite = sc.getCallSite()
```

## **checkpointData**
**当前RDD的检查点数据**

```scala
private[spark] var checkpointData: Option[RDDCheckpointData[T]] = None
```

## **checkpointAllMarkedAncestors**
**对于所有标记了需要checkpoint的祖先 是否对其全部进行checkpoint**
"默认情况下 当spark搜索到了第一个祖先RDD 就会停止checkpoint动作"

```scala
private val checkpointAllMarkedAncestors =  
Option(sc.getLocalProperty(RDD.CHECKPOINT_ALL_MARKED_ANCESTORS)).exists(_.toBoolean)
```

## **doCheckpointCalled**
**是否已经调用了doCheckpoint方法设置检查点
此属性可以阻止对RDD进行多次设置检查点**
"默认是false 即没有对RDD进行过设置检查点动作"

````scala
// Avoid handling doCheckpoint multiple times to prevent excessive recursion
@transient private var doCheckpointCalled = false
```
