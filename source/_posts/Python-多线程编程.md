---
title: '[Python]多线程编程'
date: 2020-08-09 11:03:46
tags: Python
---
**本篇主要讲解Python多线程的实现方式以及Thread类的简要剖析。**
* 调用现成的Thread类，直接使用。
* 继承Thread类，构建run方法。
<!--more-->

## 实现方式

### 实现方式一: 创建Thread实例

**将要执行的函数作为入参传入线程，创建Thread实例，调用start()方法启动线程。**

```python
import threading

def requester(name):
    print("Thread {} Started!".format(name))

if __name__ == '__main__':
    for thread_name in range(3):
        thread = threading.Thread(target=requester, args=(thread_name,))
        thread.start()
```

### 实现方式二: 继承Thread类

**继承Thread类，重写run()方法**
**将主逻辑写在run方法里，当启动的线程被cpu调度时，会自动执行该方法**

```python
from threading import Thread

class MyThread(Thread):
    # 必须调用父类的初始化方法
    def __init__(self, name):
        super(MyThread, self).__init__(name=name)
    # 线程的主要逻辑都写在这里 在start()方法被调用后，cpu调度到该线程将会自动执行run()方法
    def run(self):
        print("Thread {} Started!".format(self.name))

if __name__ == '__main__':
    for thread_name in range(3):
        thread = MyThread(name=str(thread_name))
        thread.start()
```

## Thread类剖析

```python
class Thread:
    def __init__(self, group=None, target=None, name=None,
                 args=(), kwargs=None, *, daemon=None):
```

### 构造参数

Thread类构造参数如下:

* group: 预留参数，未来拓展用
* target: 可被run()方法调用的对象，默认是None，没有东西被调用
* name: 线程名称，默认会是"Thread-N" N是数字
* args: 存放参数的元组, target函数的入参，默认是空元组()
* kargs: 关键字参数，默认是空字典{}

### 方法与属性

| 方法与属性           | 说明                                                         |
| -------------------- | ------------------------------------------------------------ |
| start()              | 启动线程，等待cpu进行调度                                    |
| run()                | 线程被cpu调度后自动执行的方法                                |
| name,setName,getName | 获取、返回、设置线程的名称                                   |
| join([timeout])      | 该方法会阻塞主调度线程，如果timeout没有设置，主调度线程会一直阻塞，直到调用了join()方法的线程结束或者超时 |
| ident                | 获取线程的标识符，该标识符是一个非零整数，只有在线程启动后才会存在，否则为返回None |
| is_alive()           | 线程是否是激活状态，从调用run()方法启动线程到run()方法终止之前的时间内，线程都是激活状态 |
| daemon, isDaemon()   | 布尔值，该属性用于指明该线程是否为守护线程, isDeamon方法返回的就是daemon值 |
| setDaemon()          | 将线程设置为守护线程，但是无法对已经激活的线程使用, daemon默认值为False，即前台线程，主线程会等待所有前台线程结束后才结束；如果设置为True，则为后台线程(守护线程)，主线程结束后，无论后台线程是否结束，都会被停止 |

### join()示例

#### 不调用join()方法

```python
from threading import Thread
import time

def rester(name):
    print("Thread {} Stared!".format(name))
    time.sleep(1)
    print("Thread {} Finished!".format(name))

if __name__ == '__main__':
    print("Main Thread Started!")
    thread_1 = Thread(target=rester, args="1")
    thread_2 = Thread(target=rester, args="2")
    thread_1.start()
    thread_2.start()
    print("Main Thread Ended!")
```

观察输出，主调度线程自己执行完毕，<u>并没有理会子线程的执行情况</u>。

```python
Main Thread Started!
Thread 1 Stared!
Thread 2 Stared!
Main Thread Ended!
Thread 1 Finished!
Thread 2 Finished!
```

#### 调用join()方法

```python
from threading import Thread
import time

def rester(name):
    print("Thread {} Stared!".format(name))
    time.sleep(1)
    print("Thread {} Finished!".format(name))

if __name__ == '__main__':
    print("Main Thread Started!")
    thread_1 = Thread(target=rester, args=("1",))
    thread_2 = Thread(target=rester, args=("2",))
    thread_1.start()
    thread_2.start()
    thread_1.join()
    thread_2.join()
    print("Main Thread Ended!")
```

观察输出，主调度线程<u>等待所有调用了join()方法的子线程执行完毕，才继续执行，</u>
join()在这里起到了阻塞主线程的作用
***PS: 同一个线程可以join()多次***

```python
Main Thread Started!
Thread 1 Stared!
Thread 2 Stared!
Thread 1 Finished!
Thread 2 Finished!
Main Thread Ended!
```

### setDaemon()示例

#### 设置守护进程 setDaemon(True)

我们知道，daemon值默认是False，即默认所有子线程都是前台线程，主线程执行完毕后，会等待所有子线程也执行完毕，才会退出。
这里将daemon设置为True，即将子线程设置为守护线程。

```python
from threading import Thread
import time

def rester(name):
    print("Thread {} Stared!".format(name))
    time.sleep(2)
    print("Thread {} Finished!".format(name))

if __name__ == '__main__':
    print("Main Thread Started!")
    thread_1 = Thread(target=rester, args="1")
    thread_2 = Thread(target=rester, args="2")
    thread_1.setDaemon(True)
    thread_2.setDaemon(True)
    thread_1.start()
    thread_2.start()
    print("Main Thread Ended!")
```

观察输出，子线程(守护线程)没有sleep完毕，就随着主线程的执行结束而结束了。
**即守护线程会随着主线程的结束而结束**

```python
Main Thread Started!
Thread 1 Stared!
Thread 2 Stared!
Main Thread Ended!
```

**线程的基本实现到这里，下篇将主要讲解[Python] 线程间通信 - 共享变量和Queue**

