---
title: '[Spark][处理方案]PySpark三方依赖'
date: 2020-05-13 21:54:17
tags:
---

**本文讲解spark **client**模式和**cluster**模式的**第三方库依赖**解决方法，注意，在用的时候需要看清楚自己的集群是哪种方法部署spark(deploy-mode)。**

<!-- more -->

## cluster模式 

**该模式亲测有效**

**1. 使用conda或virtualenv或pipenv等创建python虚拟环境 **
假设虚拟环境是pyspark_env，安装位置是：

```bash
/data1/spark_projects/envs/pyspark_env
```

**2. 安装第三方库**
安装的第三方库是：

```bash
source activate pyspark_env

pip install pandas
pip install sklearn
```

**3. 打包整个虚拟环境**(<u>**这一步是重点**</u>)
进入虚拟环境目录，压缩整个文件夹

```bash
/data1/spark_projects/envs/
zip -r -9 -q pyspark_env.zip pyspark_env/
```

-r 递归压缩
-9 better compress
-q console无输出
压缩后得到压缩包pyspark_env.zip。

**4.将压缩是虚拟环境上传到hdfs**
这样在cluster模式下 所有的executor都可以使用指定的hdfs目录下的解释器 


* **查看hdfs目标目录下的文件**
  hdfs dfs -ls hdfs://schema-hdfs/user/single/

* **上传压缩环境包到hdfs上**
  hdfs dfs –put pyspark_env.zip hdfs://schema-hdfs/user/single/

* **检查是否上传成功**
  hdfs dfs -ls hdfs://schema-hdfs/user/single/
  这里上传的hdfs目录如上，后面指定参数的时候需要**指定这个目录**。



### 参数配置

第一个参数，压缩的文件会被提取到executor到工作目录下面去，后面用#pyspark_env表示这个文件被解压到的目标目录的名称。

```bash
conf.spark.yarn.dist.archives = hdfs://schema-hdfs/user/single/pyspark_env.zip#pyspark_env
```

第二个参数，指定python的环境是哪个。

```bash
conf.spark.yarn.appMasterEnv.PYSPARK_PYTHON = pyspark_env/pyspark_env/bin/python
```

然后正常提交即可

## client模式

client模式的缺点是，要求每个节点都要安装相同的python环境。两个解决办法：

1. 在所有计算节点上安装相同版本的python，添加到PATH中，统一使用默认python解释器执行任务。
2. 类似上一点，在所有计算节点上安装anaconda等虚拟环境，并指定使用虚拟环境python进行任务执行。

### 提交方式1：全局python环境

使用统一的python环境执行任务，即使用全局的python解释器运行任务。这里相当于使用系统默认PATH下的python了，前提也是要保证所有机器下的/usr/bin/python版本一致。

```bash
/usr/hdp/2.6.4.0-91/spark2/bin/spark-submit --master yarn --queue ai \
--name {job_name} \
--conf "spark.pyspark.driver.python=/usr/bin/python3" \ # 这是重点，指定python的版本
--conf "spark.pyspark.python=/usr/bin/python3" \ # 这是重点，指定python的版本
python_file.py
```

### 提交方式2：python虚拟环境

指定虚拟环境解释器，核心是修改 driver.python 的配置项，这里的前提是，所有的计算节点都在同一目录下安装了该环境。

```bash
/usr/hdp/2.6.4.0-91/spark2/bin/spark-submit --master yarn --queue root.xx \
--name {job_name} \
--conf "spark.pyspark.driver.python=/usr/local/miniconda/envs/my_project/bin/python3" \ # 这是重点，指定虚拟环境中的python的版本
--conf "spark.pyspark.python=/usr/local/miniconda/envs/my_project/bin/python3" \ # 这是重点，指定虚拟环境中的python的版本
python_file.py
```

python_file.py的内容如下，我们测试是否真的引用了虚拟环境的python。

```python
import pymysql
import pandas as pd

print(pymysql.__path__) # 这里打印虚拟环境中的包
print(pd.__path__) # 这里打印虚拟环境中的包

from pyspark.sql import SparkSession
def main():
		spark = SparkSession.builder.enableHiveSupport().getOrCreate()
    print(pymysql.__path__) # 这里打印虚拟环境中的包
    print(pd.__path__) # 这里打印虚拟环境中的包
    spark.stop()

if __name__ == '__main__':
main()
```

输出如下，我们发现实际调用的python是我们指定的虚拟环境中的python，引用路径也是虚拟环境中安装的包。

```bash
['/home/dm/.conda/envs/processtest/lib/python3.6/site-packages/pymysql']
['/home/dm/.conda/envs/processtest/lib/python3.6/site-packages/pandas']
```

若要在所有计算节点中安装上相同的python库，推荐使用默认使用anaconda，能够覆盖大多数常用三方包。
