/**
 * 安全执行 & 错误边界
 */

export const safeExecute = (fn, context = '') => {
  return function(...args) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      console.error(`[${context || '执行错误'}]`, error);
      return null;
    }
  };
};

export const safeAsync = async (fn, context = '') => {
  try {
    return await fn();
  } catch (error) {
    console.error(`[${context || '异步错误'}]`, error);
    return null;
  }
};
