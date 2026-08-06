package i18n

var zh = catalog{
	// ---- common ----
	"err.invalid_request":                "请求无效",
	"err.invalid_request_detail":         "请求无效：%s",
	"err.invalid_request_body":           "请求体无效：%s",
	"err.not_found":                      "未找到",
	"err.internal":                       "服务器内部错误",

	// ---- admin ----
	"err.admin.bad_credentials":          "用户名或密码错误",
	"err.admin.session_issue":            "会话创建失败",
	"err.admin.session_store_failed":     "会话保存失败",
	"err.admin.not_logged_in":            "未登录",
	"err.admin.account_missing":          "账号不存在",
	"err.admin.name_length":              "名字需为 1-32 个字符",
	"err.admin.password_short":           "新密码至少 4 位",
	"err.admin.old_password_wrong":       "原密码错误",
	"err.admin.password_hash_failed":     "密码加密失败",
	"err.admin.require_login":            "请先登录管理员账号",

	// ---- chat ----
	"err.chat.guest_alloc_failed":        "无法分配游客身份",
	"err.chat.username_length":           "用户名需为 1-32 个字符",
	"err.chat.password_short":            "密码至少 4 位",
	"err.chat.username_taken":            "用户名已被占用",
	"err.chat.already_registered":        "该身份已注册，请直接登录",
	"err.chat.bad_credentials":           "用户名或密码错误",
	"err.chat.avatar_id_required":        "avatarId 为必填项",

	// ---- live ----
	"err.live.invalid_avatar_id":         "无效的 avatarID",
	"err.live.avatar_not_found":          "数字人不存在",
	"err.live.base_video_missing":        "该数字人的基础视频尚未就绪，无法开始聊天渲染",
	"err.live.session_not_started":       "直播尚未开始",
	"err.live.notify_worker_failed":      "通知 Worker 失败：%s",
	"err.live.text_required":             "text 字段为必填项",
	"err.live.push_chunk_failed":         "入队失败：%s",
	"err.live.llm_empty_reply":           "LLM 返回了空回复",

	// ---- tasks ----
	"err.task.avatar_id_required":        "avatarId 字段为必填项",
	"err.task.script_text_required":      "scriptText 字段为必填项",
	"err.task.avatar_not_found":          "数字人不存在",
	"err.task.save_failed":               "保存任务失败：%s",
	"err.task.enqueue_failed":            "任务入队失败：%s",
	"err.task.enqueue_retry_failed":      "重试入队失败：%s",
	"err.task.invalid_id":                "无效的任务 ID",
	"err.task.not_found":                 "任务不存在",
	"err.task.only_failed_retry":         "只有失败的任务才能重试",
	"err.task.avatar_not_ready":          "数字人基础视频未就绪",
	"err.task.invalid_status":            "无效的状态",
	"err.task.output_url_required":       "completed 状态必须提供 outputVideoS3Url",

	// ---- avatars ----
	"err.avatar.name_required":           "name 字段为必填项",
	"err.avatar.image_required":          "必须上传 image 文件",
	"err.avatar.upload_failed":           "图片上传失败：%s",
	"err.avatar.save_failed":             "保存数字人失败：%s",
	"err.avatar.init_enqueue_failed":     "初始化任务入队失败：%s",
	"err.avatar.invalid_id":              "无效的数字人 ID",
	"err.avatar.not_found":               "数字人不存在",
	"err.avatar.base_video_key_required": "baseVideoS3Key 字段为必填项",
	"err.avatar.delete_tasks_failed":     "删除任务失败：%s",
	"err.avatar.delete_session_failed":   "删除直播会话失败：%s",
	"err.avatar.already_initializing":    "数字人正在初始化中",
	"err.avatar.only_initializing_skip":  "只有初始化中的数字人才能跳过",
	"err.avatar.invalid_live_settings":   "直播配置无效：%s",

	// ---- tts preview ----
	"err.tts.fields_required":            "voiceId 与 text 字段均为必填项",
	"err.tts.text_too_long":              "试听文本过长（最多 200 字）",
	"err.tts.preview_failed":             "语音试听生成失败：%s",
	"err.tts.empty_audio":                "语音试听返回了空音频",

	// ---- knowledge base ----
	"err.knowledge.source_required":       "请提供 text 或上传 .txt/.pdf 文件",
	"err.knowledge.both_provided":         "text 与 file 只能二选一",
	"err.knowledge.unsupported_type":      "仅支持 .txt 或 .pdf 文件",
	"err.knowledge.upload_failed":         "知识文件上传失败：%s",
	"err.knowledge.save_failed":           "保存知识失败：%s",
	"err.knowledge.name_required":         "知识库名称不能为空",
	"err.knowledge.collection_duplicate":  "该数字人下已存在同名知识库",
	"err.knowledge.collection_invalid_id": "无效的知识库 ID",
	"err.knowledge.collection_not_found":  "知识库不存在",
	"err.knowledge.document_invalid_id":   "无效的文档 ID",
	"err.knowledge.document_not_found":    "文档不存在",
	"err.knowledge.search_required":       "请提供 avatarId/collectionId 与检索文本",
	"err.knowledge.embed_unavailable":     "本地检索服务不可用（请确认 rag-service 已启动）",
}
