---
title: '[Python]线程间通信-共享变量与Queue'
date: 2020-08-09 11:08:24
tags: Python
---

**本章主要讲解Python线程间通信的实现**
* 共享变量及其缺点
* Queue的实际使用
<!--more-->

## 共享变量
使用共享变量缺点:
* 不安全: 共享变量同时被多个线程修改，不加锁的情况下，无法保证线程安全。
* 不优雅: 凡是使用该变量的函数，都需要使用global进行共享。

### 共享变量示例

```python
import threading
# 全局变量 count
count = 0

def plus():
    # 调用global方法 函数内部作用域也能操作变量 count
    global count
    for i in range(1000000):
        count += 1

def minus():
    # 调用global方法 函数内部作用域也能操作变量 count
    global count
    for i in range(1000000):
        count -= 1

if __name__ == '__main__':
    thread_p = threading.Thread(target=plus)
    thread_m = threading.Thread(target=minus)
    thread_p.start()
    thread_m.start()
    # 等待两个线程都执行完毕后才打印最后的count值
    thread_p.join()
    thread_m.join()
    print(count)
```
共享变量: count
线程一: 负责 count+1
线程二: 负责 count-1
期望输出: 0
**<u>实际输出: 几乎每次都不同</u>**
**<u>原因: cpu随机调度线程，每个线程执行的时间不同步，从而产生脏数据</u>**

##  Queue
### 简介
* FIFO的数据结构，即先进先出。
* maxsize参数设置队列的容量上限。
* 若maxsize<=0，则队列容量视为无限。

### 属性与方法
|属性与方法|说明|
|---|---|
|qsize()|返回队列的大致大小，不可靠：qsize()>0 不保证后续的get()不被阻塞，qsize()<0不保证后续的put()不被阻塞|
|empty()|队列为空返回True，不为空返回False，不可靠：返回True不保证put()不被阻塞，返回False不保证get()不被阻塞|
|full()|队列是满的返回True，不是满的返回False，同理，不可靠|
|put(item, block=True, timeout=None)|将item放入队列，如果block为True，timeout为None，则在有必要时阻塞至有槽可用，如果timeout是正数，则最多阻塞timeout秒，如果timeout秒内没有插槽可用，抛出Full异常。反之(block=False)，如果没有插槽可用，直接引发Full异常(timeout被忽略)|
|put_nowait(item)|相当于put(item, False)，即不阻塞，放不进去直接抛异常|
|get(block=True, timeout=None)|从队列中移除并返回一个项目，若block=True，timeout=None，则在必要时阻塞至元素可得到，同put()类似，timeout正数，阻塞timeout秒直到元素可得，超时抛出Empty异常。反之(block=False)，若没有可得的元素，直接抛出Empty异常|
|get_nowait()|相当于get(item, False)，即不阻塞，取不到直接抛异常|
|task_done()|表明前面排队的任务已经被完成。每个get()被用于获取一个任务，后续调用task_done()通知队列，该任务的处理已完成。如果join()处于阻塞状态，只有在接收到所有的task_done()返回，才会释放。调用次数如果超过队列元素总数，会抛出ValueError。|
|join()|队列会一直阻塞，直到队列中所有元素被取走并处理完毕，才会释放，每添加一个元素到队列，未完成任务总数就会+1，每接收到一个task_done()信号，未完成任务总数就会-1，直到为0，join()就会释放。|

### Queue实现示例
```python
import threading
import queue
import time

# 生产者: 每0.5秒生产一条数据并插入到stream队列当中
def producer():
    for item in range(1, maxsize+1):
        # 如果队列满了会阻塞2秒，超时后抛出异常
        stream.put(item, block=True, timeout=None)
        print("Successfully added item {}".format(item))
        time.sleep(0.5)

# 消费者: 从stream队列中取数据
def consumer():
    while True:
        try:
            # 如果队列为空会阻塞2秒，超时后抛出异常 可以主动捕获该异常
            item = stream.get(block=True, timeout=2)
            print("Successfully get item: {}".format(item))
        except queue.Empty:
            # timeout后，捕获到Empty异常，主动退出循环
            print("Empty: No more objects in queue, break.")
            break

if __name__ == '__main__':
    # 创建一个容量为5的队列
    maxsize = 5
    stream = queue.Queue(maxsize)
    thread_producer = threading.Thread(target=producer, args=(stream,))
    thread_consumer = threading.Thread(target=consumer, args=(stream,))
    thread_producer.start()
    thread_consumer.start()
```

### task_done()与join()

#### 使用场景
* 我们能够确认队列里的元素被全部取走了，但是无法得知他们的<u>**处理进度**</u>
* 故task_done()用来通知Queue被get走的元素<u>**已经被处理完毕**</u>
* join()则负责使Queue<u>**一直阻塞**</u>，直到接收到所有被取走的元素处理线程返回task_done()
* 所以task_done()与join()是<u>**成对使用**</u>的

#### 使用示例
* 这里请注意，如果将self.__que.task_done()注释掉，Queue将一直阻塞下去
* 因为Queue没有接收到所有的task_done()返回，会认为队列中被取走的任务并未被完成，故不会释放

```python
from threading import Thread
from queue import Queue
from time import sleep

class MyThread(Thread):
    def __init__(self, que):
        super().__init__()
        self.__que = que

    def run(self):
        while True:
            # 取任务之前，检查队列是否为空，是的话直接结束循环
            if self.__que.empty():
                print("No More elements in queue, break.")
                break
            # 每获取一次任务
            item = self.__que.get()
            print("Successfully get item {}".format(item))
            # 处理完毕后，都调用task_done()通知queue任务已完成
            self.__que.task_done()
            sleep(1)
            print("Finished processing item {}".format(item))

if __name__ == '__main__':
    # 创建容量为10的队列
    que = Queue(10)
    # 填充任务
    for task in range(1, 11):
        que.put(task)
    # 启用2个线程执行任务
    for i in range(1, 3):
        thread = MyThread(que)
        thread.start()
    # 队列一直阻塞，直到接收到所有task_done()信号才会释放
    que.join()
    print("All tasks have been finished!")
```

**共享变量与Queue的解析就到这里，下篇主要讲解[Python] 线程同步 - Lock、RLock**

