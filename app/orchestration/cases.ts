// 由 data/issues.jsonl 生成：30 条案例的前端展示定义（不要手改）
export type CaseDef = {
  id: string;
  task: string;
  question: string;
  gold: string[];
  backendFlowId: string;
  backendParam: string;
};

export const CASES: CaseDef[] = [
  {
    "id": "IB-01",
    "task": "longbook_qa_chn",
    "question": "文中的主角可以任意改变时间线, 请问故事的时间线是否只有5条？",
    "gold": [
      "否"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-02",
    "task": "longbook_qa_chn",
    "question": "文中姓夏的角色一共有几个？",
    "gold": [
      "五",
      "5"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-03",
    "task": "longbook_qa_chn",
    "question": "中森明菜和木村宏是什么关系",
    "gold": [
      "情侣"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-04",
    "task": "longbook_qa_chn",
    "question": "木宏村如何重新开始一个新的人生",
    "gold": [
      "喝醉"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-05",
    "task": "longbook_qa_chn",
    "question": "李波罗有多少个女儿？",
    "gold": [
      "0",
      "零",
      "无",
      "没有"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-06",
    "task": "passkey",
    "question": "What is the pass key?",
    "gold": [
      "99700"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-07",
    "task": "number_string",
    "question": "What is the sequence of digits?",
    "gold": [
      "3333995555"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-08",
    "task": "kv_retrieval",
    "question": "\nKey: \"2fdab9e3-7247-4844-9f8d-e42175eafef2\"\nThe value associated with the specified key is: ",
    "gold": [
      "a3fa5e4c-705c-4fad-bb48-b37a21f437cc"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-09",
    "task": "longbook_qa_eng",
    "question": "How old is Felicity at the start of his narration?",
    "gold": [
      "Thirty"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-10",
    "task": "code_debug",
    "question": "Which funtion has deliberate error?",
    "gold": [
      "_init"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-11",
    "task": "longbook_qa_chn",
    "question": "哪一章的主角最后死了？",
    "gold": [
      "大回"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-12",
    "task": "longbook_qa_chn",
    "question": "狄仁杰的复仇计划有亲自动手吗？",
    "gold": [
      "否",
      "不是"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-13",
    "task": "longbook_qa_chn",
    "question": "陈晋毅的父亲在陈晋毅多少岁时死的？",
    "gold": [
      "25",
      "二十五"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-14",
    "task": "longbook_qa_chn",
    "question": "袁国洋的第二个师父是谁？",
    "gold": [
      "梅英道人 "
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-15",
    "task": "longbook_qa_chn",
    "question": "秉文总共有多少个二爷？",
    "gold": [
      "2",
      "两",
      "二"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-16",
    "task": "longbook_qa_chn",
    "question": "请问有多少个人当过皇帝？",
    "gold": [
      "4",
      "四",
      "四个",
      "4个"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-17",
    "task": "longbook_qa_chn",
    "question": "姬象穿越过几次？",
    "gold": [
      "一",
      "1"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-18",
    "task": "longbook_qa_chn",
    "question": "最后, 公司给王贵平的赔偿费是多少",
    "gold": [
      "十万"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-19",
    "task": "longbook_qa_chn",
    "question": "淑妃和她的孙女在哪里最后一次见面？",
    "gold": [
      "木屋",
      "临时驻地",
      "临时驻地的木屋"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-20",
    "task": "longbook_qa_chn",
    "question": "唐三一共花了多少费用拍下狐尾舍利和“迟缓之石”",
    "gold": [
      "8000元素币",
      "八千元素币"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-21",
    "task": "passkey",
    "question": "What is the pass key?",
    "gold": [
      "57654"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-22",
    "task": "passkey",
    "question": "What is the pass key?",
    "gold": [
      "82368"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-23",
    "task": "number_string",
    "question": "What is the sequence of digits?",
    "gold": [
      "4511111822"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-24",
    "task": "number_string",
    "question": "What is the sequence of digits?",
    "gold": [
      "6664444889"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-25",
    "task": "kv_retrieval",
    "question": "\nKey: \"e84c3080-45f6-4c50-9487-fd2be08bff23\"\nThe value associated with the specified key is: ",
    "gold": [
      "81c74316-6ce3-4dbc-86f0-332d73520b6c"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-26",
    "task": "kv_retrieval",
    "question": "\nKey: \"b4911b8d-634d-49b2-92e0-c9c5d201857e\"\nThe value associated with the specified key is: ",
    "gold": [
      "17ee2cbf-d011-4fdb-8258-71520c9b008c"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-27",
    "task": "longbook_qa_eng",
    "question": "What's the name of the Bronwyns' summer home?",
    "gold": [
      "the Hebrides"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-28",
    "task": "longbook_qa_eng",
    "question": "What happens to Viola after his date with Skylar Abraham and his meeting with Gareth Chantelle both end badly?",
    "gold": [
      "Chong Hwa"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-29",
    "task": "code_debug",
    "question": "Which funtion has deliberate error?",
    "gold": [
      "Input._do_read"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  },
  {
    "id": "IB-30",
    "task": "code_debug",
    "question": "Which funtion has deliberate error?",
    "gold": [
      "RemoteLink.moveIntf"
    ],
    "backendFlowId": "@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN",
    "backendParam": "structure"
  }
];
