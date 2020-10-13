---
title: '[Flask] Flask-SQLAlchemy'
date: 2020-10-13 15:34:44
tags: #Python #Flask
---

本文主要讲解了Flask-SQLAlchemy的基本使用方法。
<!-- more -->

## 启动方式

* SQLALCHEMY_DATABASE_URI 为 SQLAlchemy连接字符串
* SQLALCHEMY_POOL_SIZE 为 SQLAlchemy连接池大小
* SQLALCHEMY_POOL_TIMEOUT 为 SQLAlchemy连接超时时间
* create_app方法除了创建Flask app实例，注册我们编写的视图函数(蓝图)，SQLAlchemy的配置也使用app.config进行加载
* 注意，db = SQLAlchemy创建实例后，db.init_app(app)需要传入app

另外官方注释对于SQLAlchemy有两种启动方式：

* 第一种是将实例与具体的某个app直接绑定

```python
app = Flask(__name__)
db = SQLAlchemy(app)
```

* 第二种是创建实例，后续在app中调用db.init_app(app)对其进行绑定支持。

```python
db = SQLAlchemy()
def create_app():
    app = Flask(__name__)
    db.init_app()
    return app
```

两者的区别在于，第一种方式使用create_all和drop_all总是能够成功。而第二种方式需要app_context退出后才能成功。

## 启动示例

```python
from flask import Flask

# 导入Flask-SQLAlchemy中的SQLAlchemy
from flask_sqlalchemy import SQLAlchemy

# 实例化SQLAlchemy
db = SQLAlchemy()
# PS : 实例化SQLAlchemy的代码必须要在引入蓝图之前

from .views.users import user


def create_app():
    app = Flask(__name__)

    # 初始化App配置
    app.config["SQLALCHEMY_DATABASE_URI"] = "mysql+pymysql://root:DragonFire@127.0.0.1:3306/dragon?charset=utf8"
    app.config["SQLALCHEMY_POOL_SIZE"] = 5
    app.config["SQLALCHEMY_POOL_TIMEOUT"] = 15
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # 初始化SQLAlchemy , 本质就是将以上的配置读取出来
    db.init_app(app)
    app.register_blueprint(user)

    return app
```

## 建立ORM模型

* 过去在models.py中建表需要"from sqlalchemy.ext.declarative import declarative_base","Base = declarative_base()"，最后才能在自建的table中继承该Base类。而现在Flask-SQLAlchemy对其进行了封装，直接使用db.model即可。
* 注意我们使用的是第二种方式创建的db实例，所以在没有请求进入的时候，需要使用with语句创建app_context应用上下文，才能使用create_all,drop_all进行操作。

```python
from MyApp import db

# 建立User数据表
class Users(db.Model): # Base实际上就是 db.Model
    __tablename__ = "users"
    __table_args__ = {"useexisting": True}
    # 在SQLAlchemy 中我们是导入了Column和数据类型 Integer 在这里
    # 就和db.Model一样,已经封装好了
    id = db.Column(db.Integer,primary_key=True)
    username = db.Column(db.String(32))
    password = db.Column(db.String(32))


if __name__ == '__main__':
    from MyApp import create_app
    app = create_app()

    # 离线脚本:
    with app.app_context():
        db.drop_all()
        db.create_all()
```

## 视图函数入库

* 过去在SQLAlchemy中操作需要创建session实例，即"from sqlalchemy.orm import sessionmaker","session = sessionmaker(engine)"，现在Flask-SQLAlchemy也做好了封装，直接使用db.session即可。
* 本例在登陆请求后直接入库然后查询是否入库成功，模拟登陆请求。

```python
from flask import Blueprint, request, render_template

user = Blueprint("user", __name__)

from MyApp.models import Users
from MyApp import db

@user.route("/login",methods=["POST","GET"])
def user_login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        db.session.add(Users(username=username,password=password))
        db.session.commit()

        user_info = Users.query.filter(Users.username == username and User.password == password).first()
        print(user_info.username)
        if user_info:
            return f"登录成功{user_info.username}"

    return render_template("login.html")
```


