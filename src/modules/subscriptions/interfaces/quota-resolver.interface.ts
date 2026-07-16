export interface QuotaResolver {
  resolve(tenantId: string): Promise<number>;
}
