---
title: 'RDD详解[RDD抽象类][模板方法]'
date: 2020-04-18 11:53:48
tags:
---

![[RDD抽象类][模板方法]]([RDD抽象类][模板方法].png)

<!-- more -->

**"RDD抽象类实现了一些模板方法，用于获取当前RDD的分区数组(partitions)，RDD中某个分区的偏好位置(preferredLocations)，以及当前RDD所依赖的序列(dependencies)"**

## **partitions**

**获取当前RDD的分区数组 不管RDD有没有被checkpoint都会被计算在内**
查找分区数组的优先级: 
从Checkpoint查找 -> 读取partitions_属性 -> 调用getPartitions方法获取"

```scala
/** * Get the array of partitions of this RDD, taking 
into account whether the * RDD is checkpointed or not. */
final def partitions: Array[Partition] = {  
    checkpointRDD.map(_.partitions).getOrElse {   
        if (partitions_ == null) {      
            partitions_ = getPartitions      
            partitions_.zipWithIndex.foreach { case (partition, index) =>                                           require(partition.index == index,         
                    s"partitions($index).partition == ${partition.index}, but it should equal $index")     
             }    
         }    
         partitions_ 
     }
}
```

## **preferredLocations**

**获取某个分区的偏好位置 不管RDD有没有被checkpoint都会被计算在内**

```scala
/** * Get the preferred locations of a partition, 
taking into account whether the * RDD is checkpointed. */
final def preferredLocations(split: Partition): Seq[String] = {  
    checkpointRDD.map(_.getPreferredLocations(split)).getOrElse {                                      getPreferredLocations(split) 
    }
}
```

## **dependencies**

**获取当前RDD的所有依赖的序列 不管RDD有没有被checkpoint都会被计算在内**
**执行步骤:**
1. 从**CheckPoint**中获取RDD, 并将这些RDD封装为**OneToOneDependency**列表，
   如果从**CheckPoint**中获取到RDD的依赖，则返回RDD依赖，否则进入下一步。
2. 如果**dependencies_**等于null，调用子类实现的**getDependencies**方法获取当前
   RDD的依赖后赋予**dependencies**，最后返回**dependencies**。

```scala
/** * Get the list of dependencies of this RDD, taking 
into account whether the * RDD is checkpointed or not. */
final def dependencies: Seq[Dependency[_]] = {  
    checkpointRDD.map(r => List(new OneToOneDependency(r))).getOrElse {   
        if (dependencies_ == null) {      
            dependencies_ = getDependencies   
            }    
            dependencies_ 
    }
}
```

