UPDATE sources SET mode='电脑Agent', status='待配置', last_check='未执行', note='需配置电脑接管产品的HTTP任务接口和登录账号' WHERE id IN ('douyin','weibo','xiaohongshu');
--> statement-breakpoint
UPDATE sources SET mode='电脑Agent / 公开网页', status='待配置', last_check='未执行', note='需配置电脑接管产品，覆盖率取决于账号与平台风控' WHERE id='zhihu';
--> statement-breakpoint
UPDATE sources SET status='可执行', last_check='按任务检查', note='已实现公开索引检索，实际覆盖由站点可访问性决定' WHERE id IN ('eetop','eda365');
