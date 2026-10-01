# 数据获取脚本改造需求
- 从同脚本目录下的 ECR_Config.xlsx 中获取需要需要导出的PTC Item配置信息，具体需求如下：
-- 获取导出的数据结构：
1. ECR Master
1.1 ECR_Work Item： 通过上一级的ALM_Work Items关系关联导出
1.1.1 Sub_Work Item L1: 通过上一级的ALM_Work Items关系关联导出
1.1.1.1 Sub_Work Item L2: 通过上一级的ALM_Work Items关系关联导出
1.2 ECR_Action：通过上一级的ALM_Actions关系关联导出
1.3 ECR_Build: 通过上一级的ALM_Work Item For关系关联导出
-- Sheet 'ECR': ID列为所有第一级别要导出的ECR Item
-- Sheet 'Data_Field': Field列为所有item需要获取导出的字段