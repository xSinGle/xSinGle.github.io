---
title: '[数据结构]动态数组Array'
date: 2020-10-05 11:02:17
tags: Python, 数据结构
---

本文简要阐述了Python如何实现动态数组，以及动态数组的一些特性。
<!-- more -->

## 动态数组简述

* 三个核心概念，data,size,capacity。
* data是动态数组本身，包含所有数据。
* size表示当前数组包含的元素个数，图示里size永远指向数组末尾元素的下一个位置(因为index是从0开始计算的)。
* capacity为数组的总容量大小，每当容量不足时内部进行自动扩容，本案例默认扩容2倍。

## Python 实现动态数组

```python
class Array:
    def __init__(self, arr=None, capacity=10):
        if isinstance(arr, list):
            self.__data = arr
            self.__size = len(arr)
            return
        self.__data = [None] * capacity
        self.__size = 0  # 注意这里是当前数组中的元素个数，并不是数组总容量大小

    def get_size(self):
        """获取当前大小"""
        return self.__size

    def get_capacity(self):
        """获取容量"""
        return len(self.__data)

    def is_empty(self):
        """是否为空"""
        return self.__size == 0

    def add(self, index, e):
        """向数组中任意位置添加元素"""
        if index < 0 or index > self.__size:
            raise ValueError("Add failed.Illegal Index.")

        # 检测容量是否满了，满了则优先扩容
        if self.__size == len(self.__data):
            # 如果数组为空，先增加一个空位，往后则倍增
            if self.__size == 0:
                self._resize(1)
            else:
                self._resize(2 * len(self.__data))

        # 数组中元素右移，直到index走到当前需要插入的位置，赋值即可
        for i in range(self.__size - 1, index - 1, -1):
            self.__data[i+1] = self.__data[i]
        self.__data[index] = e
        self.__size += 1

    def add_first(self, e):
        """向头部添加元素"""
        self.add(0, e)

    def add_last(self, e):
        """向尾部添加元素"""
        self.add(self.__size, e)

    def _resize(self, new_capacity):
        """数组扩容"""
        new_data = [None] * new_capacity
        for i in range(self.__size):
            new_data[i] = self.__data[i]
        self.__data = new_data

    def get(self, index):
        """获取指定位置的元素"""
        if index < 0 or index > self.__size:
            raise ValueError("Add failed.Illegal Index.")
        return self.__data[index]

    def get_first(self):
        """获取头部元素"""
        return self.__data[0]

    def get_last(self):
        """获取尾部元素"""
        return self.__data[self.__size - 1]

    def remove(self, index):
        """删除指定位置元素"""
        if index < 0 or index > self.__size:
            raise ValueError("Remove failed.Illegal Index.")
        
        if self.__size == 0:
            raise ValueError("Remove failed.Can not remove from an empty list.")

        ret = self.__data[index]
        for i in range(index + 1, self.__size):
            self.__data[i - 1] = self.__data[i]

        self.__size -= 1
        # 如果len(self.__data)为1，除以二就会是0，不合理。
        if self.__size == len(self.__data) // 4 and len(self.__data) // 2 != 0:
           self._resize(len(self.__data) // 2)
        return ret

    def remove_first(self):
        """删除头部元素"""
        return self.remove(0)

    def remove_last(self):
        """删除尾部元素"""
        return self.remove(self.__size - 1)

    def contains(self, e):
        for i in range(self.__size):
            if self.__data[i] == e:
                return True
        return False

    def set(self, index, e):
        """修改具体位置的元素"""
        if index < 0 or index > self.__size:
            raise ValueError("Add failed.Illegal Index.")

        self.__data[index] = e
    
    def find(self, e):
        """查找具体元素的索引位置"""
        for i in range(self.__size):
            if self.__data[i] == e:
                return i
        return -1

    def __str__(self):
        return "{}: capacity: {}".format(self.__data[:self.__size], self.get_capacity())

    def __repr__(self):
        return self.__str__()


if __name__ == '__main__':
    arr = Array()

    for i in range(10):
        arr.add_last(i)
    print(arr.get_capacity())

    arr.add(1, 'zwang')
    print(arr.get_capacity())

    arr.add_first(-1)
    print(arr)

    arr.remove(8)
    print(arr)

    arr.set(0, 999)
    print(arr)


```

## 动态数组的时间复杂度

首先明确时间复杂度的基本概念：

* O(n),O(n^2)等大O描述的是算法的运行时间和输入数据之间的关系。
* 大O描述的是渐进时间复杂度，即当n趋于无穷大的情况下，该算法的运行效率如何。
* 除开特例，算法时间复杂度分析一般考虑最坏的情况，所以动态数组的时间复杂度视为O(n)。

| 操作             | 时间复杂度    | 解释                                                         |
| ---------------- | ------------- | ------------------------------------------------------------ |
| add_last(e)      | O(1)          | 直接在index为size的位置赋值即可，与数据的规模无关。          |
| add_first(e)     | O(n)          | 要将每一个元素都向后移动。                                   |
| add(index, e)    | O(n/2) = O(n) | index靠前，需要移动的元素更多，时间更长，反之亦然，平均而言是n/2，忽略常数，也是O(n)。 |
| resize()         | O(n)          | 要把原来的元素全部复制一遍到新的扩容数组内。                 |
| remove_last(e)   | O(1)          | 同add操作，只需要移动最后一个元素。                          |
| remove_first(e)  | O(n)          | 同add操作，越靠前移动的元素越多。                            |
| remove(index, e) | O(n/2) = O(n) | 同add操作，取决于删除的index位置。                           |
| set(index, e)    | O(1)          | 数组最大的优势，支持随机访问。                               |
| get(index)       | O(1)          | 同set，只要知道索引，就可以直接访问。                        |

小结：

* 增：O(n)
* 删： O(n)
* 查：已知索引O(1)；未知索引O(n)
* 改：已知索引O(1)；未知索引O(n)

不难发现，所谓的动态，其实就是动态扩缩容，在容量不确定的情况下，随着新增元素动态扩增数组容量，随着元素的减少缩小数组容量。


