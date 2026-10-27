// 只给测试用的取值助手。开启 noUncheckedIndexedAccess 后，下标取值的类型是 T | undefined；
// 测试里「这一条必须在」是用例前提，取不到就该立刻报错并说清是哪一条，
// 而不是让 undefined 溜进下一个断言、变成一句看不出原因的 TypeError。
// 生产代码不用它：那里取不到就该走各自的兜底分支。
export function at<T>(items: ArrayLike<T>, i: number, what: string): T {
  const v = items[i];
  if (v === undefined) throw new Error(`用例前提不成立：${what} 的第 ${i + 1} 条不存在`);
  return v;
}

export function one<T>(items: ArrayLike<T>, what: string): T {
  return at(items, 0, what);
}
