// 使用内存数据库以避免原生模块依赖问题
export { db, MemoryDatabase as DatabaseManager } from "./memory";
