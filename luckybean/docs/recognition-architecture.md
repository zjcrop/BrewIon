# Lucky Bean 豆袋识别架构（v0.9.6 起）

## 目标

咖啡豆袋属于柔性曲面包装，信息分散、版式不固定，并常伴随褶皱、倾斜、反光和艺术字体。识别流程不得假设整张包装是标准文档。

## 分层

1. **采集层**：正面、背面、侧面和日期标签最多四张；按缺失信息动态补拍。
2. **质量层**：检查分辨率、模糊、曝光、反光和低对比度；低质量照片允许保留但明确提示补拍。
3. **识别层**：原生端计划采用 PP-OCRv5 Mobile + ncnn；Web/PWA 计划采用 PaddleOCR.js。当前模块通过统一桥接接口调用，不让业务层依赖具体运行时。
4. **融合层**：保留每个文字块的图片来源、坐标和置信度；跨图去重后形成原始文字池。
5. **结构化层**：继续使用 Lucky Bean 编码表与文字解析器提取国家、产区、实体、品种、处理法、海拔、日期、重量和风味。
6. **确认层**：识别结果只生成候选，不直接覆盖豆卡；由用户确认后保存。

## Web 桥接接口

网页识别器可注册：

```js
window.LuckyBeanPaddleOCR = {
  async recognizeCoffeeBag(images, options) {
    return {
      engine: 'web-ppocr-v5',
      blocks: [
        { text: 'ETHIOPIA GUJI', confidence: 0.96, polygon: [], imageId: images[0].id }
      ]
    };
  }
};
```

## 原生桥接接口

Android、iOS 或 HarmonyOS 容器可向 WebView 注入：

```js
window.LuckyBeanRecognitionBridge = {
  async recognizeCoffeeBag(payload) {
    // payload.images: [{ id, role, mimeType, dataUrl }]
    return { engine: 'native-ppocr-v5-ncnn', blocks: [] };
  }
};
```

返回字段必须保持一致，以便网页端和原生端共享融合及字段解析逻辑。

## 当前阶段

v0.9.6 第一阶段完成多视角采集、照片质量评估、统一识别桥接、OCR原文修正和既有文字解析流程交接。模型文件和原生插件在后续阶段接入。
