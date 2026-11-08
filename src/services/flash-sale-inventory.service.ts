import { redis } from '../config/redis.js';

export class FlashSaleInventoryService {
  /**
   * Lua Script nguyên tử kiểm tra và trừ tồn kho trực tiếp trên RAM Redis:
   * - KEYS[1]: Key tồn kho (flash_sale:stock:{productId})
   * - ARGV[1]: Số lượng đặt mua (quantity)
   * 
   * Trả về:
   *   1: Thành công (đã trừ tồn kho an toàn, không thể over-selling)
   *   0: Thất bại (hết hàng hoặc sản phẩm không tồn tại)
   */
  private readonly DEDUCT_STOCK_LUA = `
    local currentStock = redis.call('get', KEYS[1])
    
    if not currentStock then
      return 0
    end
    
    local stock = tonumber(currentStock)
    local quantity = tonumber(ARGV[1])
    
    if not stock or stock < quantity then
      return 0
    end
    
    redis.call('decrby', KEYS[1], quantity)
    return 1
  `;

  /**
   * Lua Script hoàn trả tồn kho nguyên tử trên Redis khi Job thất bại vĩnh viễn (Rollback Compensation):
   * - KEYS[1]: Key tồn kho (flash_sale:stock:{productId})
   * - ARGV[1]: Số lượng hoàn trả (quantity)
   */
  private readonly ROLLBACK_STOCK_LUA = `
    local key = KEYS[1]
    local quantity = tonumber(ARGV[1])
    
    if not quantity or quantity <= 0 then
      return 0
    end
    
    -- Sử dụng redis.call('incrby', ...) để hoàn trả số lượng
    local newStock = redis.call('incrby', key, quantity)
    return newStock
  `;

  private getKey(productId: string): string {
    return `flash_sale:stock:${productId}`;
  }

  private async ensureConnected(): Promise<void> {
    if (redis.status === 'wait') {
      await redis.connect();
    }
  }

  /**
   * Đưa số lượng tồn kho lên Redis Key: flash_sale:stock:{productId}
   */
  async preloadStock(productId: string, stock: number): Promise<void> {
    await this.ensureConnected();
    const key = this.getKey(productId);
    await redis.set(key, stock);
  }

  /**
   * Lấy số lượng tồn kho hiện tại trên Redis
   */
  async getStock(productId: string): Promise<number | null> {
    await this.ensureConnected();
    const key = this.getKey(productId);
    const stock = await redis.get(key);
    return stock !== null ? parseInt(stock, 10) : null;
  }

  /**
   * Thực thi Lua Script trừ tồn kho nguyên tử
   * Trả về 1 nếu thành công, 0 nếu thất bại/hết hàng
   */
  async deductStock(productId: string, quantity: number): Promise<number> {
    await this.ensureConnected();
    const key = this.getKey(productId);

    // Thực thi Lua Script thông qua redis.eval
    const result = await redis.eval(
      this.DEDUCT_STOCK_LUA,
      1,
      key,
      quantity.toString()
    );

    return Number(result);
  }

  /**
   * Hoàn trả lại số lượng tồn kho vào Redis Key qua Lua Script (redis.call('incrby', ...))
   * Được gọi khi đơn hàng thất bại vĩnh viễn và bị chuyển vào Dead Letter Queue (DLQ)
   */
  async rollbackStock(productId: string, quantity: number): Promise<number> {
    await this.ensureConnected();
    const key = this.getKey(productId);

    const result = await redis.eval(
      this.ROLLBACK_STOCK_LUA,
      1,
      key,
      quantity.toString()
    );

    return Number(result);
  }
}

export const flashSaleInventoryService = new FlashSaleInventoryService();

