---
title: 'RDD详解[RDD依赖][Denpendency]'
date: 2020-04-12 20:15:39
tags:
---

![Dependency](Dependency.png)

<!-- more -->

**RDD之间的依赖关系，构建了由RDD所组成的DAG**

## **Dependency**
Spark使用**Dependency**来表示RDD之间的依赖关系，它只定义了一个rdd方法 返回当前依赖的RDD。
**NarrowDenpendency**与**ShuffleDependency**都继承自**Dependency**抽象类。
```scala
/** * :: DeveloperApi :: * Base class for dependencies. */
@DeveloperApi
abstract class Dependency[T] extends Serializable {  
    def rdd: RDD[T]}
```
如图所示，Spark中有两种依赖：
1. 窄依赖 **NarrowDenpendency**
2. 宽依赖 **ShuffleDenpendency**

## **NarrowDependency**
**概念**：如果RDD与上游RDD的分区是**<u>一对一</u>**的关系,那么RDD和其上游RDD的依赖关系属于窄依赖(NarrowDependency).

* 继承自Dependency抽象类
* 定义了一个类型为RDD的构造器参数_rdd
* _重写了rdd方法 返回构造器参数_rdd
* 定义了getParents方法 返回某一分区的**<u>所有父级别分区序列</u>**
* **NarrowDependency**存在两个子类,分别是**OneToOneDependency**和**RangeDependency**

```scala
/** 
* :: DeveloperApi :: 
* Base class for dependencies where each partition of the child RDD depends on a small number 
* of partitions of the parent RDD. Narrow dependencies allow for pipelined execution. 
*/
@DeveloperApiabstract 
class NarrowDependency[T](_rdd: RDD[T]) extends Dependency[T] { 
    /**   
    * Get the parent partitions for a child partition.   
    * @param partitionId a partition of the child RDD   
    * @return the partitions of the parent RDD that the child partition depends upon         */  
    def getParents(partitionId: Int): Seq[Int] 
    
    override def rdd: RDD[T] = _rdd}
```
### **OneToOneDependency**
![OneToOneDependency](OneToOneDependency.jpg)

* 继承了NarrowDependency
* 从重写的getParents方法中得知,子RDD的分区与依赖的父RDD分区相同,getParents方法返回的就是List(子RDD的partitionId),可以理解为子RDD的分区ID和父RDD的分区ID**<u>完全相同</u>**
```scala
/** * :: DeveloperApi :: 
* Represents a one-to-one dependency between partitions of the parent and child RDDs. 
*/
@DeveloperApiclass 
OneToOneDependency[T](rdd: RDD[T]) extends NarrowDependency[T](rdd) { 
    override def getParents(partitionId: Int): List[Int] = List(partitionId)}
```

### **RangeDependency**
![RangeDependency](RangeDependency.jpg)

* 继承了NarrowDependency
* 从重写的getParents方法中得知,子RDD的分区与依赖的父RDD分区是**<u>一一对应</u>**的,注意**<u>并不是相同,而是一对一的关系</u>**
* 假设子分区范围起始值**outStart = 5** 父分区范围起始值**inStart = 1** 只要判断在**分区范围内**
  根据代码**partitionId - outStart + inStart**可得父分区范围
  5 - 5 + 1 = 1
  6 - 5 + 1 = 2
  7 - 5 + 1 = 3
  8 - 5 + 1 = 4
  9 - 5 + 1 = 5
  可以发现子分区5-9对应的是父分区1-5,**是一对一的关系**
* 可以理解在某些情况下,子RDD是由多个父RDD组合而成的,此时每个partitionID依旧能够找到唯一对应的父partitionID

| VALUE        | DESCRIPTION                                                 |
| ------------ | ----------------------------------------------------------- |
| **inStart**  | 父RDD的分区范围起始值 所以看到图中父RDD的inStart起始值都是0 |
| **outStart** | 子RDD的分区范围起始值                                       |
| **length**   | 分区范围的大小                                              |

```scala
/** * :: DeveloperApi :: 
* Represents a one-to-one dependency between ranges of partitions in the parent and child RDDs. * @param rdd the parent RDD 
* @param inStart the start of the range in the parent RDD 
* @param outStart the start of the range in the child RDD 
* @param length the length of the range 
*/
@DeveloperApiclass 
RangeDependency[T](rdd: RDD[T], inStart: Int, outStart: Int, length: Int)  extends NarrowDependency[T](rdd) {  

    override def getParents(partitionId: Int): List[Int] = {    
        if (partitionId >= outStart && partitionId < outStart + length) {       
            List(partitionId - outStart + inStart)   
        } else {      
            Nil    
        }  
    }
 }
```

## **ShuffleDependency**

**概念**：RDD与上游RDD的分区不是一对一的关系,或者RDD的分区依赖于上游RDD的多个分区,这种依赖成为Shuffle依赖(ShuffleDependency).

* 继承了Dependency
* RDD与上游RDD不是一对一的关系 或RDD的分区依赖于上游RDD的多个分区
* 重写了**rdd方法** 将**_rdd**转换为**RDD[Product2[K,V]]**后返回
* **ShuffleDependency** 在构造过程中将自己**注册**到了**SparkContext**的**ContextCleaner**中

| VALUE                 | DESCRIPTION                                                  |
| --------------------- | ------------------------------------------------------------ |
| **_rdd**              | 泛型要求必须是Product2[K,V]及其子类的RDD                     |
| **partitioner**       | 分区计算器Partitioner                                        |
| **serializer**        | SparkEnv中创建的serializer 即org.apache.spark.serializer.JavaSerializer |
| **keyOrdering**       | 按照K进行排序的scala.math.Ordering实现类                     |
| **aggregator**        | 对map任务的输出数据进行聚合的聚合器                          |
| **mapSideCombine**    | 是否在map端进行合并 默认为false                              |
| **keyClassName**      | V的类名                                                      |
| **valueClassName**    | V的类名                                                      |
| **conbinerClassName** | 结合器C的类名                                                |
| **shuffleId**         | 当前ShuffleDependency的身份标识                              |
| **shuffleHandle**     | 当前ShuffleDependency的处理器                                |

```scala
/**
 * :: DeveloperApi ::
 * Represents a dependency on the output of a shuffle stage. Note that in the case of shuffle,
 * the RDD is transient since we don't need it on the executor side.
 *
 * @param _rdd the parent RDD
 * @param partitioner partitioner used to partition the shuffle output
 * @param serializer [[org.apache.spark.serializer.Serializer Serializer]] to use. If not set
 *                   explicitly then the default serializer, as specified by `spark.serializer`
 *                   config option, will be used.
 * @param keyOrdering key ordering for RDD's shuffles
 * @param aggregator map/reduce-side aggregator for RDD's shuffle
 * @param mapSideCombine whether to perform partial aggregation (also known as map-side combine)
 */
@DeveloperApi
class ShuffleDependency[K: ClassTag, V: ClassTag, C: ClassTag](
    @transient private val _rdd: RDD[_ <: Product2[K, V]],
    val partitioner: Partitioner,
    val serializer: Serializer = SparkEnv.get.serializer,
    val keyOrdering: Option[Ordering[K]] = None,
    val aggregator: Option[Aggregator[K, V, C]] = None,
    val mapSideCombine: Boolean = false)
  extends Dependency[Product2[K, V]] {

  if (mapSideCombine) {
    require(aggregator.isDefined, "Map-side combine without Aggregator specified!")
  }
  override def rdd: RDD[Product2[K, V]] = _rdd.asInstanceOf[RDD[Product2[K, V]]]

  private[spark] val keyClassName: String = reflect.classTag[K].runtimeClass.getName
  private[spark] val valueClassName: String = reflect.classTag[V].runtimeClass.getName
  // Note: It's possible that the combiner class tag is null, if the combineByKey
  // methods in PairRDDFunctions are used instead of combineByKeyWithClassTag.
  private[spark] val combinerClassName: Option[String] =
    Option(reflect.classTag[C]).map(_.runtimeClass.getName)

  val shuffleId: Int = _rdd.context.newShuffleId()

  val shuffleHandle: ShuffleHandle = _rdd.context.env.shuffleManager.registerShuffle(
    shuffleId, _rdd.partitions.length, this)

  _rdd.sparkContext.cleaner.foreach(_.registerShuffleForCleanup(this))
}
```
