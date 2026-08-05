# 直播字幕字体

把下载好的**免费**字体文件放到本目录（`worker/fonts/`），然后在管理后台
「Live Studio → 字幕设置」里填写对应的**文件名**（含扩展名），保存并重新开启
直播即可生效。

支持 `.ttf` / `.otf` / `.ttc`。未填写或文件不存在时自动回退到系统默认中文字体。

推荐（免费可商用）：

| 文件名 | 说明 |
| --- | --- |
| `SourceHanSansSC-Regular.otf` | 思源黑体（Adobe/Google 开源） |
| `SourceHanSansSC-Bold.otf` | 思源黑体加粗 |
| `SourceHanSerifSC-Regular.otf` | 思源宋体 |
| `AlibabaPuHuiTi-3-55-Regular.ttf` | 阿里巴巴普惠体 |
| `HarmonyOS_Sans_SC_Regular.ttf` | 鸿蒙黑体 |

下载地址示例（任选其一）：

- 思源黑体/宋体：https://github.com/adobe-fonts/source-han-sans 或
  https://github.com/adobe-fonts/source-han-serif（release 里选 OTF/SC 版本）
- 阿里巴巴普惠体：https://www.alibabafonts.com
- 鸿蒙黑体：https://developer.huawei.com/consumer/cn/design/resource/

> 注意：本目录的文件默认不提交到 git（license/体积原因），换新设备时记得把
> 字体一起拷过去。
