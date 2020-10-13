---
title: '[MySQL] MyISAM与InnoDB引擎区别'
date: 2020-10-13 15:18:58
tags: #MySQL
---

本文主要讲解MySQL两种主要引擎MyISAM与Innodb的区别。
<!-- more -->

## MyISAM

1. 不支持事务，但是整个操作是原子性的。
2. 不支持外键，支持表锁，每次锁住的是整张表。
   * 表共享读锁，在对MyISAM表进行读操作时，不会阻塞其他表的读请求，但是会阻塞其他用户对表的写请求。
   * 对其进行写操作时会阻塞对同一张表的读操作和写操作。
3. 一个MyISAM表有3个文件，索引文件，表结构文件，数据文件。
4. 存储表的总行数，执行select count(*) from table时只要简单的读出保存好的行数即可。但是带有where条件语句的count就不能直接返回，也要进行全表扫描。
5. 采用非聚集索引，索引文件数据域存储指向数据文件的指针。
6. 支持全文索引和空间索引。
7. 对于AUTO_INCREMENT类型的字段，在MyISAM表中，可以和其他字段一起建立联合索引。

MyISAM主索引图：索引文件的每个数据域存储指向数据文件的指针(每个索引指向了数据物理地址)。

![MyISAM主索引](MyISAM主索引.png)

MyISAM辅索引图：同上，但是不用保证唯一性。

![MyISAM辅索引](MyISAM辅索引.png)

## Inoodb

1. 支持事务，支持事务的4中隔离级别；是一种具有事务(commit)，回滚(rollback)和崩溃修复能力(crash recovery capabilities)的事务安全(transaction-safe(ACID compliant))型表。
2. 支持行锁和外键约束，因此可以支持写并发。
3. 不存储总行数；故执行select count(*) from table时，InnoDB要扫描全表来计算有多少行。注意的是，当count(*)语句包含where条件时，两种表的操作是一样的。(都要扫全表)
4. 对于AUTO_INCREMENT类型的字段，InnoDB中必须包含只有该字段的索引。
5. DELETE FROM table时，InnoDB不会重新建表，而是一行一行的删除。
6. 一个Innodb表可能存储在一个文件内(共享表空间，表大小不受操作系统限制)，也可能为多个文件(设置为独立表空间，表大小受操作系统限制)。
7. 主键索引采用聚集索引(索引的数据域存储数据文件本身，即通过主键来查找行数据)，辅索引的数据域存储主键的值；因此从辅索引查找数据，需要先通过辅索引找到主键值，再访问主键索引；最好使用自增主键，防止插入数据时，为维持B+树结构，文件的大调整。

InnoDB主索引图：索引位置上存储的直接是数据本身。

![InnoDB主索引](innodb主索引.png)

InnoDB辅索引图：

![InnoDB辅索引](innodb辅索引.png)

小结：

1. MyISAM管理非事务表，提供高速存储和检索以及全文搜索能力，适合应用中执行大量select操作。
2. InnoDB用于事务处理，具有ACID事务支持等特性，适合应用中执行大量的insert和update操作。
