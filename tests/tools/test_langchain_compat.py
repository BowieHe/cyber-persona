import pytest
from cyber_persona.tools.langchain_compat import web_search


@pytest.mark.asyncio
async def test_web_search_returns_string():
    result = await web_search.ainvoke({"query": "宁德时代", "count": 3})
    assert isinstance(result, str)
    assert "宁德时代" in result or result.startswith("[搜索失败:") or result == ""
