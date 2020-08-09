---
title: '[Python]Lock与RLock'
date: 2020-08-09 11:14:58
tags: Python
---

**本文简要讲解了Python锁相关的内容**
* 死锁原理
* Lock  锁
* RLock 可重入锁
<!--more-->

## 线程安全
以多个线程修改同一个变量为例，由于CPU交替执行不同线程中的字节码，会导致共享变量被修改赋值的顺序不满足我们的预期。
以下经典多线程修改共享变量场景，显然，在迭代次数足够多时，最后count的值并不是预期的0.

```python
from threading import Thread

count = 0
def incre():
    global count
    for i in range(1000000):
        count += 1

def decre():
    global count
    for i in range(1000000):
        count -= 1

if __name__ == "__main__":
    thread_in = Thread(target=incre)
    thread_de = Thread(target=decre)
    thread_in.start()
    thread_de.start()
    print(count)
```

## Lock-锁
因此，我们需要引入锁，确保同一时间点，只有获取锁的线程，才能够对变量进行修改。
注意点:
* 在需要保证线程安全的位置，获取锁，而未能获取到锁的线程，将会一直阻塞。
* 使用完锁必须释放，否则其他线程永远无法获取到锁，因为锁没有被释放。
* 锁的使用会影响多线程的性能，因为代码块只能在获取锁的线程中运行，而其他未获取锁的线程都在阻塞状态。

```python
from threading import Thread, Lock

count = 0
lock = Lock()
def incre():
    global count
    for i in range(1000000):
        # 每次对count进行修改前，先获取锁，确保只有当前线程能够对其进行修改
        lock.acquire()
        count += 1
        # 修改完毕后，必须释放锁，否则所有其他线程都会被阻塞在acquire()处
        lock.release()

def decre():
    global count
    for i in range(1000000):
        lock.acquire()
        count -= 1
        lock.release()

if __name__ == "__main__":
    thread_in = Thread(target=incre)
    thread_de = Thread(target=decre)
    thread_in.start()
    thread_de.start()
    # 调用join()确保每个线程都执行完毕
    thread_in.join()
    thread_de.join()
    print(count)
```

## 死锁
发生死锁的场景一：在未释放锁时，再次获取锁。

```python
# 省略其他代码
def incre(lock):
    global count
    for i in range(1000000):
        # 首次获取锁，由于锁未被占用，可以正常获取
        lock.acquire()
        # 锁并未被正常释放，此时再次获取锁，程序将一直阻塞在这里，造成死锁
        lock.acquire()
        count += 1
        lock.release()
```
发生死锁场景二：资源竞争，互相等待。
```python
from threading import Thread, Lock


lockA = Lock()
lockB = Lock()
count = 0

class Counter(Thread):
    def __init__(self, name):
        super().__init__(name=name)

    def incre(self):
        lockA.acquire()
        print("Function incre, Thread-{} LockA acquired, do Something".format(self.name))
        lockB.acquire()
        print("Function incre, Thread-{} LockB acquired, do Something".format(self.name))
        lockB.release()
        lockA.release()

    def decre(self):
        lockB.acquire()
        print("Function decre, Thread-{} LockB acquired, do Something".format(self.name))
        lockA.acquire()
        print("Function decre, Thread-{} LockA acquired, do Something".format(self.name))
        lockA.release()
        lockB.release()

    def run(self):
        self.incre()
        self.decre()

if __name__ == '__main__':
    for thread in range(1, 3):
        counter = Counter(name=str(thread))
        counter.start()
```

输出如下:

```python
# Function incre, Thread-1 LockA acquired, do Something
# Function incre, Thread-1 LockB acquired, do Something
# Function decre, Thread-1 LockB acquired, do Something
# Function incre, Thread-2 LockA acquired, do Something
```
观察死锁产生的过程:
线程1首先调用incre方法，获取到A锁，执行代码块。
线程1继续执行incre方法，获取到B锁，执行代码块，此时释放B锁，接着释放A锁。
线程1接着调用decre方法，获取到B锁，执行代码块。
<u>**此时!CPU切换到线程2，线程2开始执行incre方法，获取到未被占用的A锁，执行代码块**</u>
<u>**线程2继续执行incre方法，尝试获取B锁，但是B锁被线程1占用了！**</u>
<u>**线程1尝试获取A锁，但是A锁被线程2占用了！**</u>
<u>**线程1和线程2互相等待对方释放彼此需要的锁，从而造成了死锁**</u>

## RLock-可重入锁
当需要在同一个函数中重复获取锁时，可以用到RLock：可重入锁。
注意点:

* 在同一个线程中，可多次调用acquire
* acquire调用次数必须和release调用次数一样多


```python
from threading import RLock, Thread

count = 0
lock = RLock()

def counter():
    global count
    lock.acquire()
    count += 1
    # 此时锁并未被释放，decre中允许再次调用acquire获取锁
    decre()
    # 注意，decre中也调用了release方法释放锁
    # 保证acquire调用次数与release调用次数相等
    lock.release()

def decre():
    global count
    lock.acquire()
    count -= 1
    lock.release()

if __name__ == '__main__':
    t = Thread(target=counter)
    t.start()
    t.join()
    print(count)
```
**Python的Lock与RLock就讲到这里，下篇主要讲解[Python] ThreadPoolExecutor线程池**



