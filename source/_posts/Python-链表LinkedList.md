---
title: '[Python]链表LinkedList'
date: 2020-10-06 10:51:52
tags: Python
---
本文将阐述什么是链表，用Python实现链表的增删改查功能，以及使用链表实现栈和队列。
<!-- more -->

## 链表简述

1. 链表无需像传统数组一样需要预先知道数据大小，可以充分利用内存空间。(需要多少，插入多少，传统数组需要预先划分一块连续的内存空间)。
2. 链表无法实现随机读取(使用下标直接读取数据)，获取具体位置的元素要通过遍历实现。
3. 链表是最基础的动态数据结构，存在单向链表，双向链表等多种实现。

## 链表的实现

* 向链表中添加元素。
* 找到需要添加元素位置所在的节点的前一个节点(prev)。
* 将新添加的节点的next指向prev原来的next，new_node.next = prev.next
* 将前一个节点的next指向新添加的节点。prev.next = new_node
* 注意next调整的顺序，如果顺序反过来，new_node.next将指向自己本身。

![链表实现原理](链表实现原理.png)

```python
class Node:

    def __init__(self, e, next):
        self.e = e
        self.next = next


class LinkedList:

    def __init__(self):
        # 初始化的时候只有一个虚拟的头结点 没有任何数据
        self.__head = Node(None, None)
        self.__size = 0

    def get_size(self):
        # 获取链表长度
        return self.__size

    def is_empty(self):
        # 是否为空
        return True if self.__size == 0 else False

    def add(self, index, e):
        # 向链表中任意位置添加元素
        if index < 0 or index > self.__size:
            raise Exception("Add element failed. Illegal index.")

        # 最开始的节点就是虚拟头节点
        prev = self.__head

        for i in range(index - 1):
            prev = prev.next
        """
        new_node = Node(e, None)
        # 新节点的next指向前一个节点的next
        new_node.next = prev.next
        # 前一个节点的next指向新节点
        prev.next = new_node
        """

        # 优化写法 将新节点的next直接设置为前一个节点的next
        prev.next = Node(e, prev.next)

        # 记得维护size变量
        self.__size += 1

    def add_first(self, e):
        # 向链表头添加一个元素
        self.add(0, e)

    def add_last(self, e):
        # 向列表尾添加一个元素
        cur = self.__head
        for i in range(self.__size):
            cur = cur.next

        cur.next = Node(e, None)

        self.__size += 1

    def __repr__(self):
        # 重新定义魔法函数输出链表内容
        e_ls = []
        cur = self.__head
        for i in range(self.__size):
            cur = cur.next
            e_ls.append(str(cur.e))
        return "-->".join(e_ls)

    def getter(self, index):
        if index < 0 or index >= self.__size:
            raise ValueError('Get failed. Illegal index.')
        curr = self.__head.next
        for i in range(index):
            curr = curr.next
        return curr.e

    def get_first(self):
        return self.getter(0)

    def get_last(self):
        return self.getter(self.__size - 1)

    def update(self, index, e):
        # 更新具体位置的元素值
        if index < 0 or index > self.__size:
            raise Exception("Add element failed. Illegal index.")

        cur = self.getter(index)
        cur.e = e

    def remove(self, index):
        # 删除具体位置的元素
        if index < 0 or index > self.__size:
            raise Exception("Add element failed. Illegal index.")

        prev = self.__head
        # 需要找到删除元素的前一个元素
        for i in range(index -1):
            prev = prev.next
        # 让前一个元素的next直接跳过删除的节点 指向下一个节点的next即可
        prev.next = prev.next.next

        self.__size -= 1

    def remove_first(self):
        # 删除头部元素
        self.remove(1)

    def remove_last(self):
        # 删除尾部元素
        self.remove(self.__size)


if __name__ == '__main__':
    # 实例化链表
    ll = LinkedList()

    # 向链表头部添加元素
    for i in range(5):
        ll.add_first(str(i))
        print(ll)

    # 向具体位置添加元素
    ll.add(3, "999")
    print(ll)

    # 查询具体位置的元素值
    node = ll.get(3)
    print(node.e)

    # 更新具体位置的元素值
    ll.update(3, "xiaoxixi")
    print(ll)

    # 删除具体位置的元素
    ll.remove(3)
    print(ll)

    # 删除头部元素
    ll.remove_first()
    print(ll)

    # 删除尾部元素
    ll.remove_last()
    print(ll)
```

## 链表的时间复杂度

| 操作             | 时间复杂度    | 解释                                                 |
| ---------------- | ------------- | ---------------------------------------------------- |
| add_last(e)      | O(n)          | 需要遍历到添加节点的位置，将next指向新的节点。       |
| add_first(e)     | O(1)          | 直接操作虚拟头结点。                                 |
| add(index, e)    | O(n/2) = O(n) | 均摊下视为O(n)，需要遍历。                           |
| remove_last(e)   | O(n)          | 需要遍历到删除节点的前一个位置，将其跳过删除的节点。 |
| remove_first(e)  | O(1)          | 直接操作虚拟头结点。                                 |
| remove(index, e) | O(n/2) = O(n) | 与add类同。                                          |
| set(index, e)    | O(n)          | 遍历链表直到找到需要修改的节点进行赋值。             |
| get(index)       | O(n)          | 遍历。                                               |
| contains()       | O(n)          | 遍历。                                               |

## 链表实现栈

链表实现的栈与数组实现的栈，两者之间的时间复杂度数量级相差不大，可以视为一致的，不像ArrayQueue和LoopQueue这样能够达到百倍数量级的差异。

```python
class LinkedListStack:

    def __init__(self):
        # 底层由链表实现，没有容积概念。
        self.__list = LinkedList()

    def is_empty(self):
        return self.__list.is_empty()

    def get_size(self):
        return self.__list.get_size()

    def push(self, e):
        """入栈"""
        self.__list.add_first(e)

    def pop(self):
        """出栈"""
        if self.is_empty():
            raise ValueError("Can not pop from an empty stack.")
        return self.__list.remove_first()

    def peek(self):
        """查看栈顶元素"""
        return self.__list.get_first()

    def __str__(self):
        return "LinkedListStack: {} Top: {}".format(self.__list, self.peek())


if __name__ == '__main__':
    ll_stack = LinkedListStack()
    for item in range(10):
        ll_stack.push(item)
        print(ll_stack)

```

## 链表实现队列

![链表实现队列](链表实现队列.png)

* 在尾部添加节点，按照原来的实现，需要遍历到节点的位置，为了时间复杂度实现O(1)，新增tail尾指针，这样添加节点只需要将tail.next指向新节点即可。
* 由于tail添加节点方便，但是删除节点依旧需要遍历到前一个节点的位置，所以选择tail端作为入队口，head端作为出队口，即尾进头出。
* 队列只需要处理首位情况，所以不需要再使用dummyhead虚拟头结点来统一在链表中间插入节点与在链表头尾插入节点的两种情况。
* 当队列为空或者只有一个节点的时候，head=tail，两者同时指向同一个节点。

```python
class LinkedListQueue:

    class _Node:

        def __init__(self, e=None, next=None):
            self.e = e
            self.next = next

        def __str__(self):
            return str(self.e)

        def __repr__(self):
            return self.__str__()

    def __init__(self):
        self._head = None
        self._tail = None
        self._size = 0

    def get_size(self):
        return self._size

    def is_empty(self):
        return self._size == 0

    def enqueue(self, e):
        """入队"""
        # tail为None说明队列为空，此时直接将head和tail都指向新Node即可。
        if not self._tail:
            self._tail = self._Node(e)
            self._head = self._tail
        else:
            # 队列不为空，此时将tail.next指向新的节点，同时原tail改为指向新的节点。
            self._tail.next = self._Node(e)
            self._tail = self._tail.next

        self._size += 1

    def dequeue(self):
        """出队"""
        if self.is_empty():
            raise ValueError("Can not dequeue from an empty queue.")
        ret_node = self._head
        self._head = self._head.next

        # 出队后，该节点的next设置为None，脱离链表。
        ret_node.next = None

        # 特殊情况，如果队列中只有一个元素，出队后head和tail都为空。
        if not self._head:
            self._tail = None

        self._size -= 1
        return ret_node.e

    def get_front(self):
        """查看队首元素"""
        if self.is_empty():
            raise ValueError("Queue is empty.")
        return self._head.e

    def __str__(self):
        cur = self._head
        data = []
        while cur:
            data.append(str(cur.e))
            cur = cur.next
        # 对于内部实现来说，链表尾部入队，链表头部出队。
        return "LinkedListQueue: [Head] {} [Tail]".format("<->".join(data))

    def __repr__(self):
        return self.__str__()


if __name__ == '__main__':
    ll_q = LinkedListQueue()
    for i in range(10):
        ll_q.enqueue(i)
        print(ll_q)
    for i in range(10):
        ll_q.dequeue()
        print(ll_q)

```






