---
title: '[Flask] 上下文管理器AppContext与RequestContext'
date: 2020-10-13 16:42:19
tags: #Python #Flask
---

本文主要讲解了Flask中的上下文管理器概念，以及他们在框架中被使用的流程和方式。
<!-- more -->

## 请求上下文RequestContext

* 请求上下文管理请求对象**Request**，会话对象**Session**
* 当前请求的**app**应用，为了保证在一个请求周期内的任何时候任何地点访问到**Request**和**Session**，又不能发生循环导入的问题，**flask**使用request和**session**来代理当前请求的**Request**和**Session**。

```python
request = LocalProxy(partial(_lookup_req_object, "request"))
session = LocalProxy(partial(_lookup_req_object, "session"))
```

* flask框架处理请求的第一步就是创建请求上下文RequestContext。
* 该类包含所有和request相关的信息，如果request为None，会自己创建并保存到RequestContext的request属性当中。
* 该实例会在请求开始时创建，并推入_request_ctx_stack中，在请求结束时自动出栈(pop)。

```python
class RequestContext(object):
    def __init__(self, app, environ, request=None):
        self.app = app
        if request is None:
            request = app.request_class(environ) # 使用app的Request对象创建一个实例
        self.request = request # 请求上下文的request
        self.url_adapter = app.create_url_adapter(self.request)
        self.flashes = None
        self.session = None # 请求上下文的session
        self._implicit_app_ctx_stack = [] # 请求上下文的应用上下文临时存放点
        self.preserved = False
        self._preserved_exc = None
        self._after_request_functions = []
        self.match_request() # 提取请求的路由创建request对象的Rule对象
```

## request代理对象

* 指向当前请求的请求上下文RequestContext对象的request属性，即在请求上下文初始化时创建的请求对象，本质上是Request对象。
* 生命周期为一次请求期间，当请求完成后被销毁。

```python
class Request(RequestBase):
    url_rule = None # 记录本次请求的Rule对象
    view_args = None # 本次请求的参数，指的是用路由转化器得到的参数
    routing_exception = None # 如果路由匹配失败，记录错误对象

# 重要的属性
request.max_content_length # 获取该请求允许的数据包最大字节数
request.endpoint # 获取该请求的rule的标识符
request.url_charset # 获取url的编码
request.blueprint # 请求属于的蓝图

# 和路由相关的属性
print(request.url_root)
print(request.url)
print(request.url_rule)
print(request.host_url)
print(request.base_url)
print(request.path) # 路由路径，如/time
print(request.full_path) # 全路径，包括参数
print(request.script_root)
print(request.host) # 服务器的ip
print(request.access_route) # 所有转发的ip地址列表
print(request.remote_addr) # 客户端远程地址
# 结果
http://192.168.1.112:8000/
http://192.168.1.112:8000/time/time?a=1
/time/time
http://192.168.1.112:8000/
http://192.168.1.112:8000/time/time

# 获取请求数据
print(request.is_json) # 判断请求数据是否是json格式
print(request.get_json()) # 获取json数据
print(request.args) # 获取url中的参数作为字典返回,没有返回空对象
print(request.form) # 获取表单数据
print(request.values) # 同时获取表单数据和url参数
print(request.data) # 没有被其他格式解析成功的数据
print(request.files) # 获取上传的文件
print(request.cookies) # 获取cookie
print(request.headers) # 获取头部信息
```

## session

* session代理的是请求上下文RequestContext对象的session属性，其是在请求上下文被推送到栈的时候创建的session对象，类似一个字典的容器。**每次请求创建的session实例都是新的，随着请求上下文被销毁而销毁。**

## 应用上下文AppContext

* 应用上下文对象AppContext会在必要时被创建和销毁，它不会在线程间移动，并且也不会在不同的请求之间共享；因此它可以作为在一次请求中临时存放数据的地方，其主要管理本次请求的当前应用app对象和临时全局g对象。

```python
current_app = LocalProxy(_find_app)
g = LocalProxy(partial(_lookup_app_object, 'g'))
```

* flask的应用上下文可以主动创建，在不需要发生http请求的情况下；当请求上下文被推送到栈后，该请求的应用上下文会跟着创建加入栈中。

```python
class AppContext(object):
    def __init__(self, app):
        self.app = app
        self.url_adapter = app.create_url_adapter(None)
        self.g = app.app_ctx_globals_class() # app的全局变量
```

## current_app

* current_app代理的就是当前的应用，我们可以在业务处理的任何时候通过current_app获取应用app的任何属性，之所以要这样做是为了避免app对象被到处显性传递造成循环导入的错误。**current_app存在于应用上下文活跃期间，会在请求处理完成后，随着应用上下文销毁而销毁**
* current_app必须在应用上下文被创建并且被推送后才能使用。

```python
from flask import current_app

app = Flask(__name__)
with app.app_context():
    current_app.url_map
```

## g

* g一般的用法是在请求期间管理资源，其指向的是当前应用的app_ctx_globals_class属性，是一个_AppCtxGlobals对象；g对象是随着应用上下文生存或死亡。

```python
class _AppCtxGlobals(object):
    # 从g中获取数据
    def get(self, name, default=None):
        pass
    # 获取数据并且弹出
    def pop(self, name, default=_sentinel):
        pass
    # 在g中添加键值对，如果存在则忽略
    def setdefault(self, name, default=None):
        pass
```

* 我们可以将g对象看做dict的数据结构，它支持g.ab方式获取值和赋值。

```python
with app.app_context():
    g.ab = 'name' # 将{‘ab’:'name'}键值对添加到g中
    x = g.ab # 获取ab的值，如果没有会报错，所以推荐使用g.get('ab')方法
```

## 上下文管理流程

![Flask上下文管理流程](Flask上下文管理流程.png)

* 一个请求进入
* 创建请求上下文**RequestContext**
* 请求上下文入栈**RequestContext**入栈
* 创建该请求的应用上下文**AppContext**
* 应用上下文**AppContext**入栈(**RequestContext**入栈后，会检查_app_ctx_stack栈顶是否为空，如果为空，flask会主动进行入栈。)
* 处理逻辑
* 请求上下文**RequestContext**出栈
* 应用上下文**AppContext**出栈

## 小结

* 请求上下文面向开发者使用的对象主要是request和session
* 应用上下文面向开发者使用的对象主要是current_app和g
* 一次请求期间请求上下文创建后创建对应本次请求的应用上下文
* 请求上下文一般不可以单独存在，因为创建请求上下文需要请求数据作为参数，但是应用上下文可以单独存在并且可以手动推送。(with语句构建上下文，在单元测试中常用，因为单元测试中没有请求进来，只能手动入栈出栈)


