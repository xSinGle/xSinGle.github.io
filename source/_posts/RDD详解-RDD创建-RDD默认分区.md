---
title: 'RDD详解[RDD创建][RDD默认分区]'
date: 2020-05-02 14:58:39
tags:
---

本文主要探讨两个问题

1. RDD根据不同数据源的创建方式
2. RDD被创建时的分区数量是如何定义的

## 创建RDD

首先根据官网的描述，Spark可以根据任何Hadoop支持的文件系统作为数据源对RDD进行创建，如本地文件系统、HDFS、HBase、S3、text file、SequenceFiles等等。这里根据笔者生产环境涉及的情况进行说明。

* 程序中的集合
* 本地文件与HDFS文件

### 程序中的集合

Spark的**parallelize**方法支持根据程序中的集合生成RDD对象。

```scala
val data = Array(1, 2, 3, 4, 5)
val distData = sc.parallelize(data)
val dataSum = distData.reduce(a, b => a+b)
```

如代码所示，distData就是根据集合data生成的RDD对象，该RDD可以调用算子实现并行执行，如调用reduce对数组进行求和。

### 本地文件与HDFS文件

Spark的**textFile**方法可以对文本类型的RDD进行创建。入参为数据源的URI，如本地文件为"file://local/textfile/path"，HDFS文件则为"hdfs://textfile/path"，同理可得"s3://"等等。返回含有String类型的RDD对象。

```scala
val distFile = sc.textFile("file://local/textfile/path.txt")
val distFile2 = sc.textFile("hdfs://schema-hdfs/textfile/path.txt")
```

## 分区数量定义

### parallelize

从源码入手，首先看到**parallelize**(org.apache.spark.SparkContext.scala)。

```scala
  def parallelize[T: ClassTag](
      seq: Seq[T],
      numSlices: Int = defaultParallelism): RDD[T] = withScope {
    assertNotStopped()
    new ParallelCollectionRDD[T](this, seq, numSlices, Map[Int, Seq[String]]())
  }
```



* 该方法为惰性方法(lazy)，如果传入的seq是可变的(mutable)数据集合，在parallelize创建RDD之后并在触发action算子之前有一系列的修改操作(如transformation)，那么RDD只会记录这一系列的变化，直到触发action才会真正开始计算并生成对应的RDD。
* **numSlices**参数，用户可以指定该数据集合被切分为几个分区，也就是生成RDD后的partition数量。其默认值为**defaultParallelism**值。

此时就要引入本文重点配置参数**spark.default.parallelism**。

| Property Name             | Default                                                      | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Spark.default.parallelism | For distributed shuffle operations like reduceByKey and join, the largest number of partitions in a parent RDD. For operations like parallelize with no parent RDDs, it depends on the cluster manager:                                                                                       **Local mode**: number of cores on the local machine                     **Mesos** fine grained mode: 8                                                         **Others**: total number of cores on all executor nodes or 2, whichever is larger. | Default number of partitions in RDDs returned by transformations like `join`, `reduceByKey`, and `parallelize` when not set by user. |

由官方配置参数解释可知，parallelize直接操作创建的RDD所拥有的分区数，如果没有手动指定，则取决于Spark App的部署模式。

**本地模式(local):**

```shell
spark-shell --master local           不指定核数 默认spark.default.parallelism为1
spark-shell --master local[N]        指定核数为N 即spark.default.parallelism为N
spark-shell --master local[*]        有多少用多少 等于机器的核数 
```

此时又有一个疑惑，Spark是如何判断local模式下，对核数进行判断的？参照源码如下(org.apache.spark.SparkContext.scala)：

```scala
  // Spark会调用此方法进而调用createDriverEnv方法创建SparkEnv，其构造参数需要传入driver使用的核数
  // 即调用SparkContext的numDriverCores方法进行核数的获取
  private[spark] def createSparkEnv(
      conf: SparkConf,
      isLocal: Boolean,
      listenerBus: LiveListenerBus): SparkEnv = {
    SparkEnv.createDriverEnv(conf, isLocal, listenerBus, SparkContext.numDriverCores(master, conf))
  }  
  
  private[spark] def numDriverCores(master: String, conf: SparkConf): Int = {
    def convertToInt(threads: String): Int = {
      if (threads == "*") Runtime.getRuntime.availableProcessors() else threads.toInt
    }
    // 这里会对传入的参数进行正则匹配
    master match {
      // 如果只是local，则默认返回1，即只会启动一个线程执行任务 所以默认并行度为1
      case "local" => 1
      // 正则匹配local后的数字，代表需要启动执行任务的线程数量
      // 如果是"*", 则获取JVM的进程数并返回，不能小于1
      case SparkMasterRegex.LOCAL_N_REGEX(threads) => convertToInt(threads)
      // 这里只是额外多添加了任务最大重试次数，道理同上
      case SparkMasterRegex.LOCAL_N_FAILURES_REGEX(threads, _) => convertToInt(threads)
      // 如果是yarn部署模式，cluster模式直接取spark.driver.cores，否则为0
      case "yarn" =>
        if (conf != null && conf.getOption("spark.submit.deployMode").contains("cluster")) {
          conf.getInt("spark.driver.cores", 0)
        } else {
          0
        }
      case _ => 0 // Either driver is not being used, or its core count will be interpolated later
    }
  }
// 以下是对LOCAL参数进行正则匹配的规则，一目了然，不做过多解释
private object SparkMasterRegex {
  // Regular expression used for local[N] and local[*] master formats
  val LOCAL_N_REGEX = """local\[([0-9]+|\*)\]""".r
  // Regular expression for local[N, maxRetries], used in tests with failing tasks
  val LOCAL_N_FAILURES_REGEX = """local\[([0-9]+|\*)\s*,\s*([0-9]+)\]""".r
  // Regular expression for simulating a Spark cluster of [N, cores, memory] locally
  val LOCAL_CLUSTER_REGEX = """local-cluster\[\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*]""".r
  // Regular expression for connecting to Spark deploy clusters
  val SPARK_REGEX = """spark://(.*)""".r
}
```

**YARN模式:**

YARN部署模式的默认并行度spark.default.parallelism取决于所有executor节点核数的总和。如300个executor，每个executor 2核，则spark.default.parallelism=2*300=600。最小值为2。

### textFile

(org.apache.spark.SparkContext.scala)

```scala
  def textFile(
      path: String,
      minPartitions: Int = defaultMinPartitions): RDD[String] = withScope {
    assertNotStopped()
    hadoopFile(path, classOf[TextInputFormat], classOf[LongWritable], classOf[Text],
      minPartitions).map(pair => pair._2.toString).setName(path)
  }

def defaultMinPartitions: Int = math.min(defaultParallelism, 2)
```

此处以读取HDFS数据为例，需要结合Spark以及Hadoop源码进行分析。首先从上述的textFile方法入手，其返回的为hadoopFile。(org.apache.spark.SparkContext.scala)

```scala
  def hadoopFile[K, V](
      path: String,
      inputFormatClass: Class[_ <: InputFormat[K, V]],
      keyClass: Class[K],
      valueClass: Class[V],
      minPartitions: Int = defaultMinPartitions): RDD[(K, V)] = withScope {
    assertNotStopped()

    FileSystem.getLocal(hadoopConfiguration)

    val confBroadcast = broadcast(new SerializableConfiguration(hadoopConfiguration))
    val setInputPathsFunc = (jobConf: JobConf) => FileInputFormat.setInputPaths(jobConf, path)
    new HadoopRDD(
      this,
      confBroadcast,
      Some(setInputPathsFunc),
      inputFormatClass,
      keyClass,
      valueClass,
      minPartitions).setName(path)
  }
```

由hadoopFile可知，textFile方法返回的其实就是HadoopRDD。接下来就是重点，已知textFile方法不传递minPartitions参数，其默认的值最大不会超过2，也就是分区数量不会超过2个，那HadoopRDD是如何做到按照block大小决定分区数量的呢？

回顾之前讲过的RDD抽象类的接口可知，getPartitions方法由子类实现，该方法返回一个数组，包含当前RDD的所有分区。显然，HadoopRDD继承了RDD抽象类，并重写了getParititons方法，用于获取该HadoopRDD的分区数组。(org.apache.spark.HadoopRDD.scala)

```scala
  override def getPartitions: Array[Partition] = {
    val jobConf = getJobConf()
    // add the credentials here as this can be called before SparkContext initialized
    SparkHadoopUtil.get.addCredentials(jobConf)
    try {
      // 首先调用getSplits方法获取HDFS输入数据的所有分片信息
      val allInputSplits = getInputFormat(jobConf).getSplits(jobConf, minPartitions)
      // 过滤掉空的分片
      val inputSplits = if (ignoreEmptySplits) {
        allInputSplits.filter(_.getLength > 0)
      } else {
        allInputSplits
      }
      // 创建一个长度为非空分片数量的数组
      val array = new Array[Partition](inputSplits.size)
      // 遍历该数组，用HadoopPartition进行填充 
      // id为RDD的id，i为数组下标，inputSplits(i)为具体的分片数据信息
      for (i <- 0 until inputSplits.size) {
        array(i) = new HadoopPartition(id, i, inputSplits(i))
      }
      // 返回该数组
      array
    } catch {
      case e: InvalidInputException if ignoreMissingFiles =>
        logWarning(s"${jobConf.get(FileInputFormat.INPUT_DIR)} doesn't exist and no" +
            s" partitions returned from this path.", e)
        Array.empty[Partition]
    }
  }
```

由上述代码可知，HadoopRDD重写的**getPartitions**方法，通过调用**getSplits**方法获取到了Hadoop数据分片的信息，再将其封装为**HadoopPartition**实例，追加到**array**数组中进行返回，它的长度也就是我们平时认为的读取HDFS文件的默认分区数量。

继续往下走，getSplits方法是获取Hadoop数据的关键，该方法实现了InputFormat接口。(org.apache.hadoop.mapred.InputFormat.java)

```java
@InterfaceAudience.Public
@InterfaceStability.Stable
public interface InputFormat<K, V> {
	// 用于对任务的输入文件进行逻辑上的切分
  InputSplit[] getSplits(JobConf job, int numSplits) throws IOException;
	// 省略无关代码
}
```
而真正实现了文件切分逻辑的是**FileInputFormat**类。
(org.apache.hadoop.mapred.FileInputFormat.java)

```java
  public InputSplit[] getSplits(JobConf job, int numSplits)
    throws IOException {
    Stopwatch sw = new Stopwatch().start();
    FileStatus[] files = listStatus(job);
    
    // Save the number of input files for metrics/loadgen
    job.setLong(NUM_INPUT_FILES, files.length);
    // totalSize为输入文件总大小
    long totalSize = 0;                           // compute total size
    // 如果是目录直接抛出异常路径
    for (FileStatus file: files) {                // check we have valid files
      if (file.isDirectory()) {
        throw new IOException("Not a file: "+ file.getPath());
      }
      // 累加每个文件的大小，得到总大小
      totalSize += file.getLen();
    }
		// goalSize为每个split的目标大小，如果切片数量为0，则goalSize = totalSize
    // 如果切片数量不为0，则goalSize = totalSize/numSplits
    long goalSize = totalSize / (numSplits == 0 ? 1 : numSplits);
    // minSize为每个split的最小大小，由MR参数mapreduce.input.fileinputformat.split.minsize决定
    // 最小为1
    long minSize = Math.max(job.getLong(org.apache.hadoop.mapreduce.lib.input.
      FileInputFormat.SPLIT_MINSIZE, 1), minSplitSize);

    // 这里开始创建split
    ArrayList<FileSplit> splits = new ArrayList<FileSplit>(numSplits);
    NetworkTopology clusterMap = new NetworkTopology();
    // 遍历输入文件
    for (FileStatus file: files) {
      // 获取路径以及文件大小
      Path path = file.getPath();
      long length = file.getLen();
      if (length != 0) {
        FileSystem fs = path.getFileSystem(job);
        BlockLocation[] blkLocations;
        // 获取数据块block的位置信息
        if (file instanceof LocatedFileStatus) {
          blkLocations = ((LocatedFileStatus) file).getBlockLocations();
        } else {
          blkLocations = fs.getFileBlockLocations(file, 0, length);
        }
        // 判断该文件是否可以继续被切分
        if (isSplitable(fs, path)) {
          long blockSize = file.getBlockSize();
          // 通过刚才计算得到的split目标大小，split最小大小以及当前文件block的大小进行计算
          long splitSize = computeSplitSize(goalSize, minSize, blockSize);

          long bytesRemaining = length;
          // 这里bytesRemaining其实就是当前文件大小length
          // 计算方式为：当前文件大小/当前分片大小 > 1.1 
          // 即如果当前文件大小比当前分片大小大至少10%，就会继续切片，直到剩余的数据大小不会超过分片的10%
          while (((double) bytesRemaining)/splitSize > SPLIT_SLOP) {
            String[][] splitHosts = getSplitHostsAndCachedHosts(blkLocations,
                length-bytesRemaining, splitSize, clusterMap);
            splits.add(makeSplit(path, length-bytesRemaining, splitSize,
                splitHosts[0], splitHosts[1]));
            // 每次展开之后对剩余数据大小进行递减
            bytesRemaining -= splitSize;
          }
					// 将最后多余出来的尾巴追加到splits数组当中
          if (bytesRemaining != 0) {
            String[][] splitHosts = getSplitHostsAndCachedHosts(blkLocations, length
                - bytesRemaining, bytesRemaining, clusterMap);
            splits.add(makeSplit(path, length - bytesRemaining, bytesRemaining,
                splitHosts[0], splitHosts[1]));
          }
        } else {
          String[][] splitHosts = getSplitHostsAndCachedHosts(blkLocations,0,length,clusterMap);
          splits.add(makeSplit(path, 0, length, splitHosts[0], splitHosts[1]));
        }
      } else { 
        //Create empty hosts array for zero length files
        splits.add(makeSplit(path, 0, length, new String[0]));
      }
    }
    sw.stop();
    if (LOG.isDebugEnabled()) {
      LOG.debug("Total # of splits generated by getSplits: " + splits.size()
          + ", TimeTaken: " + sw.elapsedMillis());
    }
    // 最后返回含有所有数据切片，切片地址信息的splits数组
    return splits.toArray(new FileSplit[splits.size()]);
  }
```

关键步骤已添加对应注释，整个过程基本为：遍历输入的文件，获取路径、文件大小、block位置等信息；通过配置信息计算出split切分的大小界限；用该界限循环切分每个文件直到其不能再被切分为止，并把切分好的split追加到splits数组当中；最后将含有所有split信息的splits数组进行返回。

到这里，textFile方法读取HDFS文件的默认分区逻辑基本完结。

对本章节进行简单总结：

* 创建RDD常见方式有两种，分别调用SparkContext的parallelize或textFile方法。
* parallelize方法用于程序中数组转化RDD，textFile方法用于Hadoop支持的所有文件系统数据源。
* parallelize创建的RDD默认分区数量由spark.default.parallelism值决定，该值大小根据Spark部署模式有不同。
* textFile读取HDFS数据所创建的HadoopRDD默认分区数量由HDFS的block大小决定。
* 决定HadoopRDD分区数量的方法getSplits实际封装了Hadoop的getSplits方法，其根据block大小对数据进行切片。



