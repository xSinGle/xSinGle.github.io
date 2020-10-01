---
title: '[Python]协程'
date: 2020-10-01 12:42:01
tags: Python
---

本文将探讨yield from实现协程的相关概念与原理，async/await使用方法，以及进一步展示如何用asyncio实现异步HTTP请求。
<!-- more -->

## 关于协程

使用协程的原因：

1. 使用select注册+事件循环+回调的模式，代码复杂度高，维护困难。
2. 多线程实现并发，线程间切换成本高，线程间同步需要lock，效率低下。
3. 同步编程是阻塞IO，效率低下

对于协程的要求：

1. 希望能够使用同步的方式来编写异步的代码。
2. 能够使用单线程进行任务的切换。

两个要点：

1. 线程与进程是由操作系统进行切换的，而单线程内的切换意味着需要程序员自己进行操作。
2. 需要一个可以暂停的函数，并且可以在适当的时候恢复其运行。

所以有了协程，两种描述：

* 拥有多个入口的函数(更精确的形容)
* 可以暂停的函数(更易于理解的形容)，可以向暂停的地方传入值

## yield from 

### yield from 简单功能

首先，yield from本身拥有一个简单的功能，即yield from iterable。只要实现了__iter__魔法函数的对象都可以使用yield from EXPR进行操作。与yield相比，yield from会将接收到的iterable对象再次展开，相当于for item in EXPR: yield item。

```python
r = range(5)
def gen1(item):
    yield item

def gen2(item):
    yield from item

for item in gen1(r):
    print(item)

for item in gen2(r):
    print(item)

"""
range(0, 5)
0
1
2
3
4
"""
```

### send, close, throw 协程实现基础

生成器能够产出值和接收值。

send方法是核心，能够允许调用方在外部向生成器内部传入值，生成器会暂停在yield处，此时在外部通过send方法传入值，会重新激活该生成器向下运行。

```python
def gen():
    x = yield
    print(x)


if __name__ == '__main__':
    gen = gen()
    gen.send(None)
    gen.send(1)

"""
Traceback (most recent call last):
  File "/Users/single/workspaces/Temp/test.py", line 9, in <module>
    gen.send(1)
StopIteration
1
"""
```



throw方法能够在生成器当前停留的地方抛出异常。

```python
def gen():
    yield 1
    yield 2
    yield 3
    
    
if __name__ == '__main__':
    gen = gen()
    print(next(gen))
    print(next(gen))
    gen.throw(IndexError)
    print(next(gen))
    print(next(gen))


"""
在生成器当前停止的地方抛出异常
Traceback (most recent call last):
  File "/Users/single/workspaces/Temp/test.py", line 12, in <module>
    gen.throw(IndexError)
  File "/Users/single/workspaces/Temp/test.py", line 3, in gen
    yield 2
IndexError
1
2
"""
```

close方法使生成器停止在当前的yield处，再次对其进行next操作会抛出StopIteration异常。

```python
def gen():
    yield 1
    yield 2


if __name__ == '__main__':
    gen = gen()
    print(next(gen))
    gen.close()
    print(next(gen))

"""
1
Traceback (most recent call last):
  File "/Users/single/workspaces/Temp/test.py", line 10, in <module>
    print(next(gen))
StopIteration
"""
```

以上三者，实现了让生成器在需要的时候抛出异常或者停止，或者在适当的时候传入值重新将其唤醒，基本满足了协程的需要。

### 生成器状态解释

协程可以身处四个状态中的一个。当前状态可以使用inspect.getgeneratorstate(...) 函数确定，该函数会返回下述字符串中的一个。

GEN_CREATED：等待开始执行；

GEN_RUNNING：解释器正在执行（只有在多线程应用中才能看到这个状态）

GEN_SUSPENDED：在 yield 表达式处暂停；

GEN_CLOSED：执行结束；

```python
from inspect import getgeneratorstate


def gen():
    yield 1
    yield 2


if __name__ == '__main__':
    gen = gen()
    print(getgeneratorstate(gen))
    next(gen)
    print(getgeneratorstate(gen))
    next(gen)
    print(getgeneratorstate(gen))
    try:
        next(gen)
    except StopIteration as e:
        print(getgeneratorstate(gen))
"""
GEN_CREATED
GEN_SUSPENDED
GEN_SUSPENDED
GEN_CLOSED
"""
```

有了状态，结合能够调整状态的send,close等方法，就有了实现协程的基础。

### 使用yield from实现协程

首先需要明确三个核心概念：

* 调用方
* 委托生成器
* 子生成器

![yield from 协程原理](协程原理.png)

核心逻辑：调用方通过委托生成器，与子生成器之间构建了一个双向通道。一般情况下，我们编程的调用顺序是层层递进，即main->grouper->averager，然后结果返回也是averager->grouper->main。而通过yield from，main直接和averager子生成器构建了一个双向通道，averager的结果直接返回给main，main发送的消息也直接传递给averager。

以下是通过yield from实现了协程，对一组数字进行累加操作并获取返回值。

需要注意的关键点：

* 在send发送值给协程之前，需要进行预激操作，可以通过next(gen)或gen.send(None)对新创建的协程进行激活，使其执行到第一个yield表达式，准备好作为活跃的协程使用。

* 协程在yield关键字所在的位置暂停执行。在赋值语句中，如 x = yield y，=右边的代码在赋值之前执行，因此，等到客户端代码再次激活协程时才会赋值给x变量。

```python
def accumulator():
    # 子生成器 用于异步累加操作
    total = 0
    while True:
        # 从外部传入需要累加的值
        x = yield
        print("+ {}".format(x))
        if not x:
            break
        total += x
    return total


def grouper():
    # 委托生成器 作为管道使用
    total = yield from accumulator()
    return total


def main():
    # 调用方 与子生成器通过管道实现双向通道
    gen = grouper()
    # 预激协程
    gen.send(None)

    for i in range(1, 1000000):
        # main调用方直接向子协程发送累加值
        gen.send(i)
    try:
      	# 在计算结束时，再次发送None中断子协程的while True循环
        # 此时子协程终止会抛出StopIteration异常，并把最终结果附加到异常的value属性中
        gen.send(None)
    except StopIteration as e:
        print("total: {}".format(e.value))


if __name__ == '__main__':
    main()
```

### yield from 小结

1. 子生成器生产的值，都是直接传给调用方的；调用方通过.send()发送的值都是直接传给子生成器的；如果发送的是None，会调用子生成器的__next__()方法，如果不是None，会调用子生成器的.send()方法。
2. 子生成器退出时，最后的return EXPR，会触发一个StopIteration(EXPR)异常
3. yield from表达式的值，是子生成器终止时，传递给StopIteration异常的第一个参数
4. 如果调用的时候出现StopIteration异常，委托生成器会恢复运行，同时其他的异常会向上抛。
5. 传入委托生成器的异常里，除了GeneratorExit之外，其他所有的异常全部传递给子生成器的throw()方法；如果调用.throw()的时候出现了StopIteration异常，那么就回复委托生成器的运行，其他的异常全部向上抛。
6. 如果在委托生成器上调用.close()或传入GeneratorExit异常，会调用子生成器的.close()方法，没有的话就不调用。如果在.close()的时候出现了异常，那么就向上抛出异常，否则的话委托生成器会抛出GeneratorExit异常。

## async 与 await

* python3.3后引入了原生的python协程，用async和await来完成之前yield from实现的功能，语义更清晰。
* 凡是用作协程的函数都用async关键字声明，需要将控制权交给调用方的位置，使用await操作，注意这里用的asyncio.sleep方法进行切换，而不是time.sleep，因为await关键字后只能跟实现了__await__魔法函数的对象，切记在协程中不要使用同步阻塞的方法。
* asyncio.ensure_future方法可以获取到协程立即返回的future对象。与线程的future对象类似。
* asyncio.get_event_loop方法获取到事件循环。
* asyncio.run_until_complete方法将会启动事件循环，直到所有future对象都执行完成，返回其结果或者抛出其异常。

```python
import asyncio


async def downloader(url):
    print("requesting url: {}".format(url))
    await asyncio.sleep(1)
    print("finished downloading url.")
    return url


async def get_html(url):
    result = await downloader(url)
    return result


async def main():
    tasks = []
    url = "http://www.books.com/{}"
    for i in range(10):
        url = url.format(i)
        # 获取每个异步任务返回的future对象
        task = asyncio.ensure_future(get_html(url))
        tasks.append(task)

    for task in asyncio.as_completed(tasks):
        # 在downloader子协程完成后 才会将返回结果赋值给get_html的result并最终由main函数获取到
        result = await task
        print(result)


if __name__ == '__main__':
    import time
    start = time.time()

    # 获取事件循环
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())

    print("last time: {}".format(time.time() - start))

```

## asyncio实现HTTP请求

1. **asyncio**的**open_connection**方法已经将**socket**部分封装，包括建立socket，连接**host**的动作。该方法返回**StreamWriter**和**StreamReader**对象用于数据的读写。
2. **StreamWriter.write**已经完成了**unregister**将文件标识符取消注册以及**register**重新注册**EVENT_READ**可读事件的动作，所以直接进行写操作即可。
3. **async for** 语法，通过深度展开**StreamReader** -> **anext**魔法函数-> **readline** -> **readuntil** -> **wait_for_data** -> **resume_reading** -> **loop._add_reader** ->  **register**注册可读事件 -> 调用**call_back**回调函数 -> 最终调用**sock.recv**函数。也就是将我们手动实现的**socket.recv**高度封装。
4. **asyncio.ensure_future**方法，与多线程类似，协程是调用后立即返回**future**对象，不阻塞，通过该方法获取到每个协程任务对应的**future**返回。
5. 通过**asyncio.as_completed**方法，获取执行完成的任务返回结果。
6. 在主函数中，依然需要通过**asyncio.get_event_loop**创建一个**loop**，采用事件循环的方式对协程进行统一调度，以上的方法都在内部检查了**loop**是否存在且被传入，如果不存在**loop**，内部封装的逻辑会自行创建一个**loop**并加入到类属性当中。
7. 最后使用**asyncio.run_until_complete**方法启动主逻辑即可。

```python
# 使用asyncio实现协程
import asyncio
from urllib.parse import urlparse


async def get_html(url):
        url = urlparse(url)
        host = url.netloc
        path = url.path
        if path == "":
            path = "/"

        # 创建连接并返回异步读写对象
        reader, writer = await asyncio.open_connection(host, 80)

        # 发送数据
        writer.write("GET {} HTTP/1.1\r\nHOST: {}\r\nConnection: close\r\n\r\n".format(path, host).encode())

        # 接收数据
        all_lines = []
        async for raw_line in reader:
            if not raw_line:
                break
            all_lines.append(raw_line.decode())
        data = "\n".join(all_lines)
        return data


async def main():
    # 获取所有需要访问的url
    urls = ["http://shop.projectsedu.com/goods/{}/".format(i) for i in range(10)]
    tasks = []
    for url in urls:
        # 创建任务并获取每个任务异步返回的future对象
        task = asyncio.ensure_future(get_html(url))
        tasks.append(task)

    # 通过as_completed方法获取已经完成的异步任务的结果
    for task in asyncio.as_completed(tasks):
        result = await task
        print(result)


if __name__ == '__main__':
    import time
    start = time.time()

    # 创建事件循环
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())

    print("last_time: {}".format(time.time() - start))

```


