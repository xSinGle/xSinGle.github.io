---
title: '[算法] 冒泡|归并|快排|桶排 Python实现'
date: 2020-10-13 15:08:18
tags: #Python #算法
---
本文主要用Python实现了常见的排序算法，并简要阐述其实现思想。
<!-- more -->

## 冒泡排序

* 遍历每一个元素，将其与后面的所有元素都对比一遍，按大小交换位置。
* 两重循环，时间复杂度为O(n^2)

```python
def bubble_sort(ls):
    if len(ls) < 2:
        return ls

    for i in range(len(ls) - 1):
        for j in range(i+1, len(ls)):
            if ls[i] > ls[j]:
                ls[i], ls[j] = ls[j], ls[i]


if __name__ == '__main__':
    ls = [5, 3, 9, 11, 32, 15]
    bubble_sort(ls)
    print(ls)
```

## 快速排序

* 使用分治法，选取数组的第一个元素作为基准值pivot，以pivot为标准，比pivot小的放入left侧，比pivot大的放入right侧。
* 对于被切分开的left和right数组继续递归执行相同操作，直到无法再被切分。
* 最终将所有切分开的数组进行合并，小+pivot+大。
* 时间复杂度为O(logn)

```python
# divide and conquer 分治法
# 选取基准值pivot
# 以基准值为标准，递归不断地将数组切分为大小两部分，直到无法再分
# 小+pivot+大 完成排序

def quick_sort(array):
    if len(array) < 2:
        return array

    # 获取基准值
    pivot = array[0]
    less = [i for i in array if i < pivot]
    more = [i for i in array if i > pivot]

    return quick_sort(less) + [pivot] + quick_sort(more)


if __name__ == '__main__':
    print(quick_sort([3, 5, 10, 2, 1, 99, 68]))
```

## 归并排序

* 采用分治法，数组长度除以二获取长度中间值将数组一切为二。
* 定义merge函数合并两个数组，其中存在a和b两个指针，依次对比两个数组对应指针的值大小，按顺序插入新数组，直到指针移动到尽头，多出来的元素(如数组a和b的长度不同)，直接追加到新数组末端即可。
* 递归调用，直到每个数组都不可再切分(长度<2)。
* 时间复杂度为O(logn)，但是需要额外的辅助空间O(n)。

```python
# 归并算法
# 创建双指针
# 递归


def merge(left, right):
    final = []
    a = b = 0

    while a < len(left) and b < len(right):
        # 两个指针都是从0开始移动，下标取值，小的优先添加到新的数组
        if left[a] < right[b]:
            final.append(left[a])
            a += 1
        else:
            final.append(right[b])
            b += 1

    # 任意一个指针到头，都退出循环
    # 如果a指针移动到末端 则多出来的元素必定在right数组内 直接追加即可
    if a == len(left):
        for i in right[b:]:
            final.append(i)
    else:
        for i in left[a:]:
            final.append(i)

    return final


def merge_sort(ls):
    if len(ls) < 2:
        return ls
    # 获取中间值
    middle = len(ls) // 2
    left = merge_sort(ls[:middle])
    right = merge_sort(ls[middle:])
    return merge(left, right)


if __name__ == '__main__':
    print(merge_sort([3, 2, 11, 5, 9]))
```

## 桶排序

* 利用空间换取时间，根据序列中最大元素自定桶的数量。
* 每个桶都为key:value形式，{数字:出现的次数}，遍历数组，将每个数字出现的次数统计到value当中记录。
* 遍历桶，依次取出每个value不为0的数字，直到取完。
* 时间复杂度为O(m+n)，m为桶的数量，我们遍历了一次所有桶，n为循环的数量。(常数暂时忽略)

```python
# 桶排序 用空间换取时间


def bucket_sort(ls):
    # 创建包含元素的桶
    buckets = {item: 0 for item in range(max(ls)+1)}

    # 统计频率 加入桶
    for num in ls:
        buckets[num] += 1

    final = []
    for k, v in buckets.items():
        while v != 0:
            final.append(k)
            v -= 1
    return final


if __name__ == '__main__':
    print(bucket_sort([5, 3, 11, 29, 23, 12]))
```
