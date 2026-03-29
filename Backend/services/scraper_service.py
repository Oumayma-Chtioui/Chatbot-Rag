import os
from langchain_core.documents import Document
import logging
import trafilatura 

logger = logging.getLogger(__name__)
def scrape_url(url: str):
    logger.info(f"🔍 Fetching URL: {url}")
    downloaded = trafilatura.fetch_url(url)
    logger.info(f"🔍 Downloaded content length: {len(downloaded) if downloaded else 0}")
    content = trafilatura.extract(downloaded)
    logger.info(f"🔍 Extracted content length: {len(content) if content else 0}")
    if not content:
        return []
    
    return [Document(
        page_content=content,
        metadata={"source": url}
    )]
