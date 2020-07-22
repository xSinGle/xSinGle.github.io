---
title: 'RDD详解[RDD信息][RDDInfo]'
date: 2020-04-19 14:13:41
tags:
---

![[RDD信息][RDDInfo]]([RDD信息][RDDInfo].png)

**"RDDInfo用于描述RDD的基本信息，包括内存磁盘缓存资源使用，作用域调用栈内容，以及分区数量存储级别等基本信息。"**

## 属性

| **Property**               | **Description**                                              |
| -------------------------- | ------------------------------------------------------------ |
| **id**                     | RDD的id                                                      |
| **name**                   | RDD的名称                                                    |
| **numPartitions**          | RDD的分区数量                                                |
| **storageLevel**           | RDD的存储级别，即StorageLevel                                |
| **callSite**               | RDD的用户调用栈信息                                          |
| **scope**                  | RDD的操作范围。scope的类型为RDDOperationScope，没回一个RDD都有一个RDDOperationScope。RDDOperationScope与Stage或job之间并无特殊关系，一个RDDOperationScope可以存在于一个Stage内，也可以跨越多个Job。 |
| **numCachedPartitions**    | 缓存的分区数量，默认为0                                      |
| **memSize**                | 使用的内存大小                                               |
| **diskSize**               | 使用的磁盘大小                                               |
| **externalBlockStoreSize** | Block存储在外部的大小                                        |

## 方法

### isCached

**是否已经缓存 返回布尔值**
**"如果内存使用量+磁盘使用量大于0 且 缓存的分区数量大于0 则返回True"**

```scala
def isCached: Boolean = (memSize + diskSize > 0) && numCachedPartitions > 0
```

### compare

**RDDInfo继承了Ordered 重写了compare方法用于排序**

```scala
override def compare(that: RDDInfo): Int = {  
    this.id - that.id
}
```

### fromRDD

**RDDInfo的伴生对象中 定义了fromRDD方法 用于从RDD构建出对应的RDDInfo**

1.获取当前RDD的名称(即name属性) 作为RDDInfo的name属性 如果RDD还没有名称，那么调用Utils工具类的getFormattedClassName方法生成RDDInfo的name属性
2.获取当前RDD依赖的所有父RDD的身份标识作为RDDInfo的parentIds属性
3.创建RDDInfo对象

```scala
private[spark] object RDDInfo {  
    def fromRdd(rdd: RDD[_]): RDDInfo = {    
        val rddName = Option(rdd.name).getOrElse(Utils.getFormattedClassName(rdd))   
        val parentIds = rdd.dependencies.map(_.rdd.id)
        new RDDInfo(rdd.id, rddName, rdd.partitions.length,    
            rdd.getStorageLevel, parentIds, callSite, rdd.scope)
        }
```


