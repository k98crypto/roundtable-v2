# 技能简报（只放简报，不放技能本体代码，删 .md 即除）

- Impeccable（pbakaus/impeccable，Apache-2.0）：设计技能，24 命令、62 条确定性规则、PRODUCT.md；hook 在部分工具中被拒命令时也可能运行，装前须审；单测：只审 WebUI 一页；hook 不自动装。
- Ponytail（DietrichGebert/ponytail，MIT）：精简技能，懒人梯子决策阶梯与 /ponytail-review、/ponytail-audit；严谨实测代码少约 54%、token 少约 22%，早期 94% 宣传已被作者撤回/修正，勿用；取代原模糊“手术式小改别重写”说法，不双轨；单测：只审小 diff。
- security-audit（cloudflare/security-audit-skill，MIT）：Markdown 指令 + 2 个无依赖 JS 校验器 + JSON schema，六阶段，猎手与证伪者分离，verdict 为 confirmed/needs_validation/rejected，产出 findings.json 与三份报告；约 30k 行需 3-4 小时，公开版对证伪者独立只是指令要求、不能强制、Cloudflare 内部编排器未公开；只在无网络沙箱、只审用户自有代码；单测：先审小测试库。
- Graphify（Graphify-Labs/graphify，Apache-2.0，Python）：代码本地 tree-sitter 解析、无向量库，产出 graph.html/GRAPH_REPORT.md/graph.json，文档/图片/媒体第二遍走模型或 key，PyPI 包名 graphifyy 双 y；只作只读索引、永不当真相，meetings.json 仍是真相；门槛测试：临时夹对圆桌代码与 CS-Knife 各跑一次，比图谱查调用关系与 grep 的 token/时间，先不开 --strict 与 git hook，私有代码不开 --deep 除非用户另批。

技能开关规则（代码见 lib/roundtable.mjs）：手动一律先审查、给同意/不同意的具体原因、人工拍板后才生效（按建议执行 / 按原意执行 / 取消）；自动选择只提议不悄悄开且受手动锁约束；手动锁已锁时自动提议不生效。
