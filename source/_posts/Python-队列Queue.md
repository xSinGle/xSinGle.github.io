---
title: '[Python]队列Queue'
date: 2020-10-05 11:10:02
tags:
---
本文将讲解Python通过动态数组实现队列Queue，以及Queue的一些基本特性。
后续的文章中将采用链表方式再次实现队列，leetcode中与Queue或Stack相关的解实际都可以用list来操作。

<!-- more -->

* 队列也是一种线性结构。
* 相比数组，队列对应的操作是数组的子集。
* 队列只能从一端(队尾)添加元素，只能从另一端(队首)取出元素。

```python
class ArrayQueue:
    def __init__(self):
        self.__arr = Array()
        self.__size = self.__arr.get_size()

    def enqueue(self, e):
        """入队：队尾添加元素"""
        self.__arr.add_last(e)
        self.__size += 1

    def dequeue(self):
        """出队：队首移除元素"""
        ret = self.__arr.remove_first()
        self.__size -= 1
        return ret

    def get_front(self):
        """获取队首元素"""
        return self.__arr.get_first()

    def get_size(self):
        """获取队列大小"""
        return self.__size

    def is_empty(self):
        """是否为空"""
        return self.__size == 0

    def __str__(self):
        queue = [str(self.__arr.get(i)) for i in range(self.__size)]
        return "ArrayQueue: [Front] {} [Tail]".format("-->".join(queue))

    def __repr__(self):
        return self.__str__()


if __name__ == '__main__':
    q = ArrayQueue()
    for i in range(10):
        q.enqueue(i)

    print(q)
    for i in range(10):
        q.dequeue()
        print(q)

```

## 队列的时间复杂度

| 操作        | 时间复杂度 | 解释                                           |
| ----------- | ---------- | ---------------------------------------------- |
| enqueue()   | O(1)       | 均摊复杂度为O(1)                               |
| dequeue()   | O(n)       | 每次取出第一个元素，其他所有元素都要向前移动。 |
| get_front() | O(1)       | 直接取出队首元素。                             |
| get_size()  | O(1)       | 直接返回内部维护的size。                       |
| is_empty()  | O(1)       | 判断size。                                     |

数组队列与数组栈大致相同，主要区别是FIFO还是LIFO。数组队列有一个致命的缺陷，就是每一次出队dequeue，都要对所有的元素进行一次操作，当数据规模巨大的时候，性能将会非常差，因此有了下面的循环队列LoopQueue。

## 循环队列

![LoopQueue原理](LoopQueue原理.png)

重点：

* 维护了两个指针，front和tail。front指针永远指向队首元素，tail指针永远指向队尾元素的下一个位置，也就是下一次入队的位置。
* 要确保每次插入都有至少一个空位，预设的队列容量len(self.data)必须多留一个空位，如用户期望存放10个元素，我们内部维护的队列长度为10+1=11。故意多留的空位用户无感知，所以当用户查看队列容量时，返回的值应该是10，也就是len(self.data)-1。
* 维护front和tail指针，由于不再对每一个元素进行移动操作，需要通过取模运算让front和tail两个指针回到开头进行循环，计算方式为(指针 + 1) % 队列总长度，返回的就是该指针的下一个位置。
* 当front == tail 的时候，队列为空，因为开始时队列中没有任何元素，两者都指向0。
* 当(tail + 1) % 队列总长度 == front 的时候，队列为满，因为tail循环的下一个位置与front指向的位置重叠，此时需要激活扩容。
* 扩容的原理和数组相同，创建新容积的队列，遍历所有元素即可。注意新队列元素的摆放位置是从0开始的，即当front不为0的时候，新队列中每个元素的index与旧队列中的index存在front的偏移量，所以new_data[index] = old_data[(index + 1) % 队列总长度]。
* 由于在队首插入元素不再移动所有其他元素，只需要维护指针指向即可，所以最终的时间复杂度为O(1)。

```python
class LoopQueue:
    """
    有意识的浪费一个空间，用于适应(tail + 1) % == front队列为满的情况，用户无感知。
    """
    def __init__(self, capacity=10):
        # 注意这里的capacity是用户认为的capacity，我们内部的list长度实际上是+1，所以取模运算的分母实际上为capacity+1
        self.__data = [None] * (capacity + 1)
        self.__front = 0
        self.__tail = 0
        self.__size = 0

    def get_capacity(self):
        """一个空间是故意浪费掉的，用户无感知，返回时要减去"""
        return len(self.__data) - 1

    def is_empty(self):
        """当tail == front的时候，队列中为空"""
        return self.__tail == self.__front

    def get_size(self):
        """当前有多少个元素"""
        return self.__size

    def enqueue(self, e):
        """入队"""
        # 首先，如果队列满，就要进行扩容操作。
        if (self.__tail + 1) % self.get_capacity() == self.__front:
            self._resize(self.get_capacity() * 2)
        # 赋值
        self.__data[self.__tail] = e
        # 维护tail指针，这里的分母是list的实际长度。
        self.__tail = (self.__tail + 1) % len(self.__data)
        self.__size += 1

    def dequeue(self):
        """出队"""
        if self.is_empty():
            raise ValueError("Dequeue failed.Can not dequeue from an empty queue.")

        # 获取当前队首的元素返回。
        ret = self.__data[self.__front]
        # 队首元素出队后，将其赋值为None
        self.__data[self.__front] = None
        # 维护front指针，对list长度进行取模获取最新的循环位置。
        self.__front = (self.__front + 1) % len(self.__data)
        self.__size -= 1

        # 如果当前存储的元素数量等于队列容量(用户认为的容量)的四分之一，而且缩容的值不应为0。
        if self.__size == self.get_capacity() // 4 and self.__size // 2 != 0:
            self._resize(self.get_capacity() // 2)

        return ret

    def _resize(self, new_capacity):
        """扩缩容"""
        # 创建新长度的list
        new_data = [None] * new_capacity
        # 无论原来的循环队列如何放置元素，统一从0开始重新摆放，当前一共有size个元素。
        for index in range(self.__size):
            # 由于front不一定为0，所以每一个新index与原index都存在front的偏移量
            new_data[index] = self.__data[(index + self.__front) % len(self.__data)]
        self.__data = new_data

        # 重新从0开始摆放元素
        self.__front = 0
        # 当前有多少个元素，tail的index就在该元素后一个位置
        self.__tail = self.__size

    def get_front(self):
        """查看队首元素"""
        if self.is_empty():
            raise ValueError("Can not get front element from an empty queue.")

        return self.__data[self.__front]

    def __str__(self):
        # 两种情况，第一种是还没有开始循环，tail在front后面正常排序。
        if self.__tail >= self.__front:
            return "LoopQueue: Front {} Tail, capacity: {}".format(self.__data[self.__front: self.__tail],
                                                                   self.get_capacity())
        # 第二种已经开始循环，tail在front前面。
        else:
            return "LoopQueue: Front {} Tail, capacity: {}".format(self.__data[self.__front:] +
                                                                   self.__data[:self.__tail], self.get_capacity())

    def __repr__(self):
        return self.__str__()


if __name__ == '__main__':
    loop_queue = LoopQueue(capacity=6)
    for i in range(10):
        loop_queue.enqueue(i)
        print(loop_queue)
    for i in range(10):
        loop_queue.dequeue()
        print(loop_queue)

```

## 循环队列的时间复杂度

| 操作        | 时间复杂度 | 解释                                             |
| ----------- | ---------- | ------------------------------------------------ |
| enqueue()   | O(1) 均摊  | 并不是每一次入队都会导致扩容，均摊下来视为O(1)。 |
| dequeue()   | O(1) 均摊  | 并不是每一次出队都会导致缩容，均摊下来视为O(1)。 |
| get_front() | O(1)       | 直接取的front指针位置的元素即可。                |
| get_size()  | O(1)       | 直接返回内部队列的长度。                         |
| is_empty()  | O(1)       | 直接判断front和tail两个指针是否相等。            |

与ArrayQueue主要的性能差别在于dequeue的操作，ArrayQueue的dequeue操作需要将队列中所有元素都向前移动一个位置，为O(n)级别，而LoopQueue中一般只需要维护指针的指向即可，为O(1)级别。(没有缩容的情况下)
