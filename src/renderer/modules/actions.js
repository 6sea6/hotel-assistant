/**
 * 函数注册表 —— 解决模块间循环依赖。
 *
 * 模块在加载时将自身的「被其它模块调用」的函数注册到此处，
 * 其它模块通过 actions.xxx() 调用，无需直接 import 源模块。
 */
export const actions = {};
