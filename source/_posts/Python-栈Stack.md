---
title: '[Python]栈Stack'
date: 2020-10-05 11:04:37
tags: Python
---

本文简要阐述了栈的基本概念以及应用，并通过Python实现栈的数据结构。
<!-- more -->

## 栈的简述

* 栈是一种线性结构。相比数组，栈对应的操作是数组的子集。
* 只能从一端添加元素，也只能从一端取出元素，这一端称为栈顶。
* 栈是一种后进先出的数据结构LIFO。

## 栈的应用

### IDE等编辑器实现撤销操作？

编辑器存在一个称为Undo的栈，用于记录用户每一次的操作，每次编辑的内容都将入栈记录，而撤销动作(command+x)将取出栈顶的元素，即上一次的操作，将其删除从而回复到操作之前的状态。

![Stack实现撤销动作](Stack实现撤销动作.png)

### 系统如何暂停当前函数的执行，转而实现子函数的调用？

如A函数中调用子函数B，B函数中又调用子函数C。

* 暂停A函数时，将A函数以及暂停位置压入系统栈记录，然后执行B函数。
* 当B函数执行到要调用子函数C位置，在暂停B函数时，将B函数以及暂停位置压入系统栈记录，继续执行C函数。
* 当C函数执行完毕后，系统将查看系统栈，此时栈顶是B函数暂停的位置，将其出栈，继续执行B函数。
* 当B函数执行完毕后，系统将查看系统栈，此时栈顶是A函数暂停的位置，将其出栈，继续执行A函数。
* 最后栈为空，所有函数执行完毕。

![Stack执行原理](Stack执行原理.png)

## 栈的实现

通过动态数组来实现栈，基础的数据结构沿用动态数组。

* 核心方法就是push,pop,peek。分别为入栈，出栈，查询栈顶元素。
* 其余方法如get_size查询当前栈的大小(元素个数)，is_empty是否为空，以及定义魔法函数输出内容并指明栈顶在某端。

```python
class ArrayStack:
    """
    通过动态数组实现栈
    """
    def __init__(self, capacity=0):
        self.__arr = Array(capacity=capacity)
        self.__size = 0

    def get_size(self):
        """获取栈的大小"""
        return self.__size

    def is_empty(self):
        """是否为空"""
        return True if self.__size == 0 else False

    def push(self, e):
        """入栈"""
        self.__arr.add_first(e)
        self.__size += 1

    def pop(self):
        """出栈"""
        ret = self.__arr.remove_first()
        self.__size -= 1
        return ret

    def peek(self):
        """查询栈顶元素"""
        return self.__arr.get_first()

    def get_capacity(self):
        """动态数组构建的Stack特有方法，获取其容量"""
        return self.__arr.get_capacity()

    def __str__(self):
        """指明栈顶位置[top]"""
        stack = [str(self.__arr.get(i)) for i in range(self.__arr.get_size())]
        return "ArrayStack: [top] {}".format('-->'.join(stack))

    def __repr__(self):
        return self.__str__()


if __name__ == '__main__':
    array_stack = ArrayStack()
    for i in range(10):
        array_stack.push(i)
        print(array_stack)

    print(array_stack.pop())
    print(array_stack.pop())
    print(array_stack.pop())

    print(array_stack)
    print(array_stack.peek())


```

## 使用栈实现括号匹配(leetcode题目)

核心思路：

* 遍历所有的字符串，只要是左括号，推入栈，如果是右括号，检查是否能与栈顶括号匹配，不行就是错误。
* 需要特别注意最终栈必须为空，否则就是不完全匹配。
* 也要注意根本不存在左括号，也就是只有右括号时，取值会造成的数组越界问题。

```python
class Solution:
    def isValid(self, s: str) -> bool:
        stack = []
        for item in s:
            if item in ("(", "[", "{"):
                stack.append(item)
            else:
                if len(stack) == 0:
                    return False
                if item == ")" and stack.pop() != "(":
                    return False
                if item == "]" and stack.pop() != "[":
                    return False
                if item == "}" and stack.pop() != "{":
                    return False
        return len(stack) == 0


if __name__ == '__main__':
    s = Solution()
    print(s.isValid("[([]])"))
    print(s.isValid("]"))
 
```

可以看到，栈的实现实际上是数组的一个子集，根据后进先出的特点对数组的部分功能进行改造即可实现栈的逻辑。
