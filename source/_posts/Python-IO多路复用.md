---
title: Python-IO多路复用
date: 2020-09-29 13:40:41
tags: Python
---

五种IO模型：阻塞IO，非阻塞IO，IO多路复用，信号驱动式IO，异步IO。
本文以socket发送HTTP请求为例，重点说明阻塞IO，非阻塞IO，IO多路复用的IO模型的实现以及优缺点。
<!-- more -->
## 阻塞IO

![阻塞IO](阻塞IO.jpg)

* 每次与HOST建立连接，发送请求，都是阻塞的。等待的时间将有大量的CPU资源被浪费。
* CPU需要不断询问IO流是否有数据返回，做大量无用的循环。
* 由于请求是阻塞的，每个请求都需要启动一个线程/进程进行处理，并发效率低下。

```python
import socket
from urllib.parse import urlparse

def get_url(url):
    url = urlparse(url)
    host = url.netloc
    path = url.path
    if path == "":
        path = '/'

    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # 创建连接
    client.connect((host, 80))

    # 发送请求信息
    client.send("GET {} HTTP/1.1\r\nHOST: {}\r\nConnection: close\r\n\r\n".format(path, host).encode())

    # 不断查看socket是否有返回信息
    d = b""
    while True:
        r = client.recv(1024)
        if not r:
            break
        d += r
    return d.decode()

```



## 非阻塞IO

![非阻塞IO](非阻塞IO.jpeg)

* 建立连接的动作发起后立即返回，不再等待连接建立完毕才执行其他操作。
* 虽然不再阻塞在连接建立处，但是却需要不断检查连接是否成功建立，以便顺利发送消息，增加了CPU消耗。等待时间没有减少。
* 由于非阻塞IO，当有数据从socket里返回时，不意为着系统内核已经把所有数据都复制到用户区供程序使用，所以要处理异常。

```python
import socket
from urllib.parse import urlparse


def get_url(url):
    url = urlparse(url)
    host = url.netloc
    path = url.path
    if path == "":
        path = "/"

    # 创建连接并设置为非阻塞模式
    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    client.setblocking(False)

    # 建立连接 由于是非阻塞 直接向下执行
    try:
        client.connect((host, 80))
    except BlockingIOError:
        pass

    # 连接可能未建立完成 需要捕捉异常不断发送消息直到成功
    # 而这一步与阻塞消耗的时间相同 却消耗了更多的CPU用于循环
    while True:
        try:
            client.send("GET {} HTTP/1.1\r\nHOST: {}\r\nConnection: close\r\n\r\n".format(path, host).encode())
            break
        except OSError:
            pass

    # 接收消息 当有消息返回时 并不意味着内核已经把所有数据都复制到了用户区供程序读取
    # 所以要捕捉异常 一直往IO里读
    d = b""
    while True:
        try:
            r = client.recv(1024)
            if not r:
                break
            d += r
        except BlockingIOError:
            pass

    return d.decode()

```



## IO多路复用

![IO多路复用](IO多路复用.jpeg)

* 通过select + 回调 + 事件循环的方式实现IO多路复用。
* 单线程调度，节省了线程间的切换。
* 非阻塞IO，节省了建立连接和请求的等待时间。
* 通过注册标识符来判断状态，调用回调函数处理多个socket连接。
* 依旧有进步的空间，即从内核复制数据到用户空间的时间依旧没有节省，最好的情况应该是数据复制好并可用后再进行处理。

```python
import socket
from selectors import DefaultSelector, EVENT_WRITE, EVENT_READ
from urllib.parse import urlparse

# 根据操作系统的不同 selector会自行选择poll/epoll Windows会有错误 UNIX没有问题
selector = DefaultSelector()


class Fetcher:

    def __init__(self, url):
        self.url = urlparse(url)
        self.host = self.url.netloc
        self.path = self.url.path
        if self.path == "":
            self.path = "/"
        self.data = b""

        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.client.setblocking(False)

        # 创建连接
        try:
            self.client.connect((self.host, 80))
        except BlockingIOError:
            pass

        # 首先在selector里面注册socket 需要监听的事件 以及最后要回调的函数
        # 由于是初始化的时候注册 所以是监听写事件 当连接就绪时 调用写函数逻辑（注意是函数名称，不是函数调用）
        selector.register(self.client.fileno(), EVENT_WRITE, self.connected)

    def connected(self, key):
        # 连接成功建立后 发送请求的逻辑
        # 首先取消注册这个写事件的监听 fd是client.fileno()的返回值
        selector.unregister(key.fd)

        # 发送消息 因为是事件监听就绪后才写 所以一定不会有异常
        self.client.send("GET {} HTTP/1.1\r\nHOST: {}\r\nConnection: close\r\n\r\n".format(self.path, self.host).encode())

        # 发送消息后 重新注册一个用于监听读事件 (注意是函数名称，不是函数调用)
        selector.register(self.client.fileno(), EVENT_READ, self.readable)

    def readable(self, key):

        # 连接有数据进来 并不代表内核空间已经将所有数据都准备好并复制到用户空间
        # 所以这里不需要while True一直查询有没有数据进来 只要有数据 就会调用readable方法进行读取
        r = self.client.recv(1024)
        if r:
            self.data += r
        else:
            # 如果是空 说明数据已经读完 直接从selector取消注册
            selector.unregister(key.fd)
            data = self.data.decode()
            print(data)
            self.client.close()


# 不像线程由系统内核进行调度 select状态变化之后的回调是由程序员自行操作的
# 重点 事件循环 不停地请求socket的状态并调用对应的回调函数
# 核心都是 select(poll/epoll)+回调+事件循环
def loop():
    # 该方法返回一个list，里面放的是nametuple
    # namedtuple('SelectorKey', ['fileobj', 'fd', 'events', 'data'])
    # 其中fd是client.fileno()的返回值，data中是对应的回调函数
    while True:
        ready = selector.select()
        for key, mask in ready:
            # 获取回调函数
            call_back = key.data
            # 获取到回调函数后直接调用
            call_back(key)


if __name__ == '__main__':
    for i in range(1, 21):
        url = "http://www.baidu.com"
        fetcher = Fetcher(url)
    loop()
```

## 小结

1. 阻塞IO与非阻塞IO实际消耗的时间相同，而非阻塞IO消耗额外的CPU资源进行轮询，两者都效率低下，并且一个线程只能处理一个socket。
2. IO多路复用采用事件循环+回调+select的方式，通过将文件标识符注册到select当中来判断socket的状态，当准备就绪时立刻回调函数处理数据，实现单线程管理多个socket，节省多线程启动和切换的内存以及CPU资源。

