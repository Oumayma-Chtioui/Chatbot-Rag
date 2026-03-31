import os
from langchain_core.documents import Document
import logging
import trafilatura 
from trafilatura.spider import focused_crawler

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

def crawl_website(url: str):
    logger.info(f" Starting crawl")
    to_visit, known_links = focused_crawler(url, max_seen_urls=50)
    logger.info(f" Finished crawl")
    logger.info(f"To visit: {to_visit}, Known links: {known_links}")
    return to_visit, known_links

def scrape_website(url: str):
    to_visit, known_links = crawl_website(url)
    documents = []
    for link in known_links:
        logger.info(f"🔍 Scraping link: {link}")
        docs = scrape_url(link)
        documents.extend(docs)
    return documents