from langchain_core.tools import tool
from cyber_persona.tools.search import SearchTool


@tool
async def web_search(query: str, count: int = 10) -> str:
    """Search the web for the given query and return a formatted result string."""
    search = SearchTool()
    try:
        results = await search.search(query)
        lines = []
        for r in results[:count]:
            lines.append(f"Title: {r.title}\nURL: {r.url}\nSnippet: {r.snippet}")
        return "\n\n---\n\n".join(lines)
    except Exception as exc:
        return f"[搜索失败: {exc}]"
    finally:
        await search.close()
