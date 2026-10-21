// tests/who-growth.test.js —— utils/who-growth.js 数据结构不变量测试
// 断言：boy/girl 各指标数组长度=37、months 为 0..36、
//       同月龄 P3<=P15<=P50<=P85<=P97、各百分位随月龄单调非降、男>=女（P50）。
// 注意：数据为近似参考值（非 WHO 官方精确值，见 data/who-growth.README.md），
//       本测试只校验结构与趋势不变量，不校验具体数值精度。
const WHO = require("../utils/who-growth.js");

const SEXES = ["boy", "girl"];
const METRICS = ["height", "weight", "head"];
const PCTS = ["P3", "P15", "P50", "P85", "P97"];

describe("who-growth 数据结构", () => {
  test("顶层含 boy / girl", () => {
    expect(WHO).toBeTruthy();
    expect(WHO.boy).toBeTruthy();
    expect(WHO.girl).toBeTruthy();
  });

  SEXES.forEach((sex) => {
    METRICS.forEach((metric) => {
      describe(`${sex}.${metric}`, () => {
        const block = WHO[sex][metric];

        test("存在且含 months 与 5 条百分位", () => {
          expect(block).toBeTruthy();
          expect(Array.isArray(block.months)).toBe(true);
          PCTS.forEach((p) => {
            expect(Array.isArray(block[p])).toBe(true);
          });
        });

        test("months 为 0..36（长度 37）", () => {
          expect(block.months.length).toBe(37);
          for (let i = 0; i <= 36; i++) {
            expect(block.months[i]).toBe(i);
          }
        });

        test("每条百分位数组长度 = 37", () => {
          PCTS.forEach((p) => {
            expect(block[p].length).toBe(37);
          });
        });

        test("同月龄 P3<=P15<=P50<=P85<=P97", () => {
          for (let i = 0; i <= 36; i++) {
            expect(block.P3[i]).toBeLessThanOrEqual(block.P15[i]);
            expect(block.P15[i]).toBeLessThanOrEqual(block.P50[i]);
            expect(block.P50[i]).toBeLessThanOrEqual(block.P85[i]);
            expect(block.P85[i]).toBeLessThanOrEqual(block.P97[i]);
          }
        });

        test("各百分位随月龄单调非降", () => {
          PCTS.forEach((p) => {
            for (let i = 1; i <= 36; i++) {
              expect(block[p][i]).toBeGreaterThanOrEqual(block[p][i - 1]);
            }
          });
        });

        test("所有数值为正数", () => {
          PCTS.forEach((p) => {
            block[p].forEach((v) => {
              expect(typeof v).toBe("number");
              expect(v).toBeGreaterThan(0);
            });
          });
        });
      });
    });
  });

  describe("常识趋势：男孩 P50 整体 >= 女孩", () => {
    METRICS.forEach((metric) => {
      test(`${metric} 各月龄 boy.P50 >= girl.P50`, () => {
        const boy = WHO.boy[metric].P50;
        const girl = WHO.girl[metric].P50;
        for (let i = 0; i <= 36; i++) {
          expect(boy[i]).toBeGreaterThanOrEqual(girl[i]);
        }
      });
    });
  });
});
