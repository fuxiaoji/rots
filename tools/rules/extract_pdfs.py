from __future__ import annotations

import hashlib
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
RULES_ROOT = ROOT / "docs" / "rules"
SOURCE_PDF_DIR = RULES_ROOT / "sources" / "pdf"


@dataclass(frozen=True)
class Source:
    key: str
    title: str
    external_path: Path
    stored_name: str


SOURCES = (
    Source(
        key="eots-v3.2-zh-rules",
        title="太阳帝国（EOTS）V3.2 中文规则（2024-02）",
        external_path=Path(r"D:\downloads\太阳帝国（EOTS）V3.2中文规则202402.pdf"),
        stored_name="eots-v3.2-zh-rules-202402.pdf",
    ),
    Source(
        key="erasmus-v2-zh-charts",
        title="伊拉斯谟 v2.0 图表汉化",
        external_path=Path(r"D:\downloads\伊拉斯谟v2.0_图表汉化.pdf"),
        stored_name="erasmus-v2-zh-charts.pdf",
    ),
)


CHAPTERS = (
    ("01-game-introduction", "1.0 游戏介绍", 1, 6),
    ("02-setup", "2.0 游戏起始设置", 6, 7),
    ("03-overview", "3.0 游戏梗概", 7, 7),
    ("04-sequence-of-play", "4.0 游戏流程", 7, 8),
    ("05-strategy-cards", "5.0 策略卡", 8, 10),
    ("06-zoi-supply-activation-control", "6.0 ZOI、补给、启动与控制", 11, 16),
    ("07-offensives", "7.0 攻势", 16, 19),
    ("08-movement-stacking", "8.0 移动与堆叠", 19, 25),
    ("09-combat", "9.0 战斗结算", 25, 30),
    ("10-reinforcements-asp", "10.0 增援与两栖运输点数", 31, 32),
    ("11-replacements", "11.0 补员", 32, 33),
    ("12-strategic-warfare", "12.0 战略作战", 33, 34),
    ("13-national-status", "13.0 国家状态", 35, 40),
    ("14-inter-service-rivalry", "14.0 内部军种对立", 40, 40),
    ("15-war-in-europe", "15.0 欧洲战事", 40, 41),
    ("16-campaign-victory", "16.0 全战役剧本胜利", 41, 43),
    ("appendix-design-team", "附录：设计团队与译后记", 43, 43),
)


ERASMUS_TITLES = (
    "日本：早期阶段决策轴",
    "日本：中期阶段决策轴",
    "日本：终局阶段决策轴",
    "日本：全阶段卡牌选择",
    "日本：全阶段任务部队编成",
    "日本：全阶段反应",
    "盟军：早期阶段决策轴",
    "盟军：中期阶段决策轴",
    "盟军：终局阶段决策轴",
    "盟军：全阶段卡牌选择",
    "盟军：全阶段任务部队编成",
    "盟军：全阶段反应",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_page_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8", newline="\n")


def page_block(source: Source, page_number: int, text: str) -> str:
    return (
        f"## PDF 第 {page_number} 页\n\n"
        f"> 来源：`docs/rules/sources/pdf/{source.stored_name}`，PDF 第 {page_number} 页。"
        "本段为机械文本提取，版面关系以原 PDF 为准。\n\n"
        f"{text}\n"
    )


def extract_source(source: Source) -> tuple[Path, list[str]]:
    if not source.external_path.exists():
        raise FileNotFoundError(source.external_path)
    stored_path = SOURCE_PDF_DIR / source.stored_name
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source.external_path, stored_path)
    reader = PdfReader(str(stored_path))
    pages = [clean_page_text(page.extract_text() or "") for page in reader.pages]

    raw_dir = RULES_ROOT / "raw" / source.key / "pages"
    for index, text in enumerate(pages, start=1):
        write(
            raw_dir / f"page-{index:03d}.md",
            "---\n"
            f"source: {source.stored_name}\n"
            f"source_page: {index}\n"
            "extraction: pypdf-text-layer\n"
            "status: raw-unverified\n"
            "---\n\n"
            f"# {source.title} - PDF 第 {index} 页\n\n"
            "> 机械提取文本。不得单独作为规则裁定依据；请与同页 PDF 版面核对。\n\n"
            f"{text}",
        )

    full_text = "\n\n---\n\n".join(
        page_block(source, index, text) for index, text in enumerate(pages, start=1)
    )
    write(
        RULES_ROOT / "normalized" / source.key / "00-full-text-by-page.md",
        f"# {source.title} - 逐页全文\n\n"
        "> 状态：自动提取、尚未完成逐条人工校对。页面分隔和来源页码已保留。\n\n"
        f"{full_text}",
    )
    return stored_path, pages


def build_rulebook_chapters(source: Source, pages: list[str]) -> None:
    chapter_dir = RULES_ROOT / "normalized" / source.key / "chapters"
    index_lines = ["# 规则书章节索引", "", "> 章节跨页时会在相邻文件重复整页，以避免上下文丢失。", ""]
    for slug, title, first, last in CHAPTERS:
        filename = f"{slug}.md"
        index_lines.append(f"- [{title}]({filename})：PDF 第 {first}-{last} 页")
        body = "\n\n---\n\n".join(
            page_block(source, number, pages[number - 1]) for number in range(first, last + 1)
        )
        write(
            chapter_dir / filename,
            f"# {title}\n\n"
            f"> 覆盖 PDF 第 {first}-{last} 页；自动提取文本，需按规则编号继续人工校对。\n\n"
            f"{body}",
        )
    write(chapter_dir / "README.md", "\n".join(index_lines))


def build_erasmus_index(source: Source, pages: list[str]) -> None:
    chart_dir = RULES_ROOT / "normalized" / source.key / "charts"
    index_lines = [
        "# 伊拉斯谟图表索引",
        "",
        "> 流程图的箭头、节点位置和分支关系无法由 PDF 文本层可靠表达。当前文件用于检索；实现 AI 前必须对照原 PDF 逐节点转写。",
        "",
    ]
    for number, (title, text) in enumerate(zip(ERASMUS_TITLES, pages), start=1):
        filename = f"{number:02d}-{title.replace('：', '-').replace(' ', '-')}.md"
        index_lines.append(f"- [{title}]({filename})：PDF 第 {number} 页")
        write(
            chart_dir / filename,
            f"# {title}\n\n"
            f"> 来源：PDF 第 {number} 页。状态：文本已提取，流程拓扑待人工结构化。\n\n"
            f"{text}",
        )
    write(chart_dir / "README.md", "\n".join(index_lines))


def build_inventory(records: list[tuple[Source, Path, list[str]]]) -> None:
    lines = [
        "# 规则来源清单",
        "",
        "所有哈希均针对仓库内保存的 PDF，便于后续确认规则版本未被静默替换。",
        "",
        "| 来源 | 页数 | SHA-256 | 用途 |",
        "|---|---:|---|---|",
    ]
    for source, path, pages in records:
        purpose = "基础游戏规则" if source.key.startswith("eots") else "PvE 决策图表"
        lines.append(f"| `{path.name}` | {len(pages)} | `{sha256(path)}` | {purpose} |")
    lines.extend(
        [
            "",
            "## 已知范围缺口",
            "",
            "- 中文规则书目录列出 17.0-22.0，但本附件正文在 16.48 后进入设计团队与译后记。17.0-22.0 未包含在该 PDF 中。",
            "- 当前未入库原始英文规则、官方勘误和 FAQ，因此中文规则出现歧义时暂不能完成权威交叉核验。",
        ]
    )
    write(RULES_ROOT / "sources" / "README.md", "\n".join(lines))


def build_qa(records: list[tuple[Source, Path, list[str]]]) -> None:
    total_pages = sum(len(pages) for _, _, pages in records)
    empty_pages = [
        f"{source.key}:{index}"
        for source, _, pages in records
        for index, text in enumerate(pages, start=1)
        if not text.strip()
    ]
    write(
        RULES_ROOT / "qa" / "extraction-report.md",
        "# PDF 转写质量报告\n\n"
        f"- 来源文件：{len(records)}\n"
        f"- 总页数：{total_pages}\n"
        f"- 已生成逐页 Markdown：{total_pages}\n"
        f"- 空文本页：{', '.join(empty_pages) if empty_pages else '无'}\n"
        "- 提取方式：PDF 内置文本层，经 `pypdf` 读取；未使用 OCR。\n"
        "- 视觉抽检：规则书第 1、27、43 页及图表第 1、6、8、12 页已通过 Poppler 渲染检查。\n\n"
        "## 风险\n\n"
        "1. 规则书为双栏版式，机械提取可能在栏切换、脚注、表格和图片题注处打乱阅读顺序。\n"
        "2. 伊拉斯谟为复杂流程图，文本层不保留箭头、连线与节点空间关系，不能直接生成状态机。\n"
        "3. 个别标题在 PDF 文本层中被拆字，例如“策略卡”可能提取成跨行文本。\n"
        "4. 目录列出的 17.0-22.0 不在附件正文中。\n\n"
        "## 下一轮人工校对\n\n"
        "- 按规则编号建立 `rule-id -> page -> normalized text` 索引。\n"
        "- 优先校对状态机关键章节：4.0、6.0、7.0、8.0、9.0、12.0、13.0、16.0。\n"
        "- 将 12 页伊拉斯谟图表转成显式节点、条件、分支、随机掷骰和动作表。\n",
    )
    write(
        RULES_ROOT / "qa" / "open-questions.md",
        "# 待确认问题\n\n"
        "- [ ] 补充规则书 17.0-22.0 的来源文件，或确认这些章节不属于当前实现范围。\n"
        "- [ ] 补充原始英文 V3.2 规则、官方勘误与 FAQ，用于冲突裁定。\n"
        "- [ ] 确认 PvE 第一目标阵营：先实现日本、先实现盟军，或同步实现。\n"
        "- [ ] 确认首个支持剧本；建议从规则范围较小的 South Pacific 开始。\n",
    )


def build_root_readme(records: list[tuple[Source, Path, list[str]]]) -> None:
    write(
        RULES_ROOT / "README.md",
        "# 《太阳帝国》规则知识库\n\n"
        "## 目录\n\n"
        "- `sources/pdf/`：固定版本的来源 PDF。\n"
        "- `raw/`：逐页机械提取，禁止语义改写。\n"
        "- `normalized/`：按章节或图表主题组织的检索版本。\n"
        "- `qa/`：提取质量、缺失资料、冲突和人工校对记录。\n\n"
        "## 当前状态\n\n"
        f"已处理 {len(records)} 个来源、{sum(len(p) for _, _, p in records)} 页。"
        "当前版本适合全文检索和后续人工结构化，不应直接作为未经校验的自动裁定器。\n",
    )


def main() -> None:
    records: list[tuple[Source, Path, list[str]]] = []
    for source in SOURCES:
        stored_path, pages = extract_source(source)
        records.append((source, stored_path, pages))
        if source.key.startswith("eots"):
            build_rulebook_chapters(source, pages)
        else:
            build_erasmus_index(source, pages)
    build_inventory(records)
    build_qa(records)
    build_root_readme(records)
    print(f"Processed {len(records)} sources and {sum(len(p) for _, _, p in records)} pages.")


if __name__ == "__main__":
    main()
