package com.resurface.app

import org.json.JSONObject

/**
 * Pulls Open Graph tags out of a public post page. Tolerant by design: a page that does not look
 * the way we expect yields null (or just the raw description), never an exception. The server
 * re-validates everything, so this only has to be good enough to be useful.
 */
object OgParser {
    private val META_TAG = Regex("<meta\\s[^>]*>", RegexOption.IGNORE_CASE)
    private val ATTR = Regex("([a-zA-Z:_-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')")

    // 1,234 likes, 56 comments - username on October 3, 2026: "caption".
    private val DESCRIPTION = Regex(
        "^(?:[\\d.,]+[KkMm]? likes?,\\s*)?(?:[\\d.,]+[KkMm]? comments?\\s*)?-?\\s*" +
            "([A-Za-z0-9._]{1,30}) on [^:\"]{3,40}:\\s*\"([\\s\\S]*?)\"\\.?\\s*$"
    )

    fun parse(html: String, shortcode: String): JSONObject? {
        val og = HashMap<String, String>()
        for (tag in META_TAG.findAll(html)) {
            val attrs = HashMap<String, String>()
            for (m in ATTR.findAll(tag.value)) {
                attrs[m.groupValues[1].lowercase()] = m.groupValues[2].ifEmpty { m.groupValues[3] }
            }
            val key = attrs["property"] ?: attrs["name"] ?: continue
            val content = attrs["content"] ?: continue
            if (key.startsWith("og:") && !og.containsKey(key)) og[key] = decode(content)
        }

        val description = og["og:description"]?.trim().orEmpty()
        val match = if (description.isNotEmpty()) DESCRIPTION.find(description) else null
        val caption = match?.groupValues?.get(2)
        val author = match?.groupValues?.get(1)
        if (caption.isNullOrEmpty() && author.isNullOrEmpty()) return null

        val out = JSONObject().put("shortcode", shortcode)
        caption?.let { out.put("caption", it) }
        author?.let { out.put("author_username", it) }
        og["og:image"]?.let { out.put("thumbnail_url", it) }
        return out
    }

    private fun decode(s: String): String {
        var out = s
            .replace("&quot;", "\"").replace("&#39;", "'").replace("&#039;", "'")
            .replace("&lt;", "<").replace("&gt;", ">")
        out = Regex("&#x([0-9a-fA-F]+);").replace(out) { codePoint(it.groupValues[1].toInt(16)) }
        out = Regex("&#(\\d+);").replace(out) { codePoint(it.groupValues[1].toInt()) }
        return out.replace("&amp;", "&")
    }

    private fun codePoint(cp: Int): String =
        if (cp in 0..0x10FFFF) String(Character.toChars(cp)) else ""
}
