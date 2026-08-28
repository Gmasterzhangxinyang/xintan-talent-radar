import { unique } from "./json";

const TECH_ONTOLOGY: Record<string, string[]> = {
  UVM: ["uvm", "universal verification methodology"],
  SystemVerilog: ["systemverilog", "system verilog", "sv"],
  Verilog: ["verilog", "rtl"],
  VCS: ["vcs"],
  Verdi: ["verdi"],
  SoC: ["soc", "片上系统"],
  GPU: ["gpu", "图形处理器"],
  DFT: ["dft", "可测试性设计", "scan chain"],
  STA: ["sta", "静态时序"],
  Innovus: ["innovus"],
  PrimeTime: ["primetime", "prime time"],
  Calibre: ["calibre"],
  数字验证: ["数字验证", "功能验证", "verification"],
  数字后端: ["数字后端", "physical design", "place and route", "p&r"],
  模拟IC: ["模拟ic", "analog ic", "模拟集成电路"],
  射频: ["射频", "rf"],
  PLL: ["pll", "锁相环"],
  ADC: ["adc", "模数转换"],
  PMIC: ["pmic", "电源管理"],
  FPGA: ["fpga"],
  ARM: ["arm"],
  RISC_V: ["risc-v", "riscv"],
  流片: ["流片", "tapeout", "tape-out"],
};

const KNOWN_COMPANIES = [
  "华为海思", "海思", "壁仞", "燧原", "沐曦", "摩尔线程", "紫光展锐", "芯原",
  "圣邦微", "思瑞浦", "兆易创新", "寒武纪", "地平线", "芯动科技", "英伟达", "AMD",
];

const DEFAULT_SIGNALS = ["看机会", "准备离职", "考虑跳槽", "团队调整", "项目被砍", "裁员", "扩招", "开放HC", "流片延期"];
const DEFAULT_EXCLUDES = ["培训", "课程", "招生", "广告", "猎头同行", "营销号", "代写"];

function includesAlias(text: string, alias: string) {
  const normalized = alias.toLowerCase();
  if (!/^[a-z0-9][a-z0-9 .+&-]*$/.test(normalized)) return text.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export function parseJd(jd: string) {
  const lowered = jd.toLowerCase();
  const techKeywords = Object.entries(TECH_ONTOLOGY)
    .filter(([, aliases]) => aliases.some((alias) => includesAlias(lowered, alias)))
    .map(([canonical]) => canonical.replace("RISC_V", "RISC-V"));
  const processes = jd.match(/(?:\d{1,2}\s*nm|\d{1,2}纳米)/gi) ?? [];
  const companyKeywords = KNOWN_COMPANIES.filter((company) => lowered.includes(company.toLowerCase()));
  const years = jd.match(/(?:\d+\s*年(?:以上|及以上|左右)?|[三五七八十]+年(?:以上|及以上|左右)?)/)?.[0] ?? "";
  const locations = unique((jd.match(/北京|上海|深圳|杭州|南京|成都|武汉|西安|苏州|无锡|合肥|广州/g) ?? []));
  const role = jd.match(/(?:数字验证|验证|数字后端|模拟IC|芯片设计|DFT|STA|射频|FPGA)[^，。；\n]{0,10}(?:工程师|专家|负责人)?/i)?.[0] ?? "芯片设计人才";
  const expanded = unique([
    ...techKeywords,
    ...processes.map((item) => item.replace(/\s/g, "")),
    ...(techKeywords.includes("数字验证") ? ["验证工程师", "功能验证", "RTL验证"] : []),
    ...(techKeywords.includes("数字后端") ? ["Physical Design", "P&R", "Sign-off"] : []),
    ...(techKeywords.includes("模拟IC") ? ["Analog IC", "模拟设计"] : []),
  ]).slice(0, 18);

  return {
    role,
    years,
    locations,
    techKeywords: expanded.length ? expanded : ["芯片设计", "项目经验"],
    companyKeywords,
    signalKeywords: DEFAULT_SIGNALS,
    excludeKeywords: DEFAULT_EXCLUDES,
    queryGroups: [
      unique([role, ...expanded.slice(0, 4), ...locations]).join(" "),
      unique([...companyKeywords, "裁员", "扩招", "项目调整", "流片"]).join(" "),
      unique([...expanded.slice(0, 3), "看机会", "离职", "跳槽"]).join(" "),
    ].filter((query) => query.length > 2),
    engine: "chip-ontology-v1",
  };
}
