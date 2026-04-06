import os
import time
from langchain_core.documents import Document
import logging
import trafilatura
from trafilatura.spider import focused_crawler
from concurrent.futures import ThreadPoolExecutor, as_completed
import asyncio

logger = logging.getLogger(__name__)


async def render_with_playwright_async(url: str) -> str | None:
    """Render a URL using Playwright (async version for FastAPI)"""
    try:
        from playwright.async_api import async_playwright
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.set_extra_http_headers({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
            })
            # Set timeout and wait for network idle
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)  # wait 2 seconds
            content = await page.content()
            await browser.close()
            
            return content
            
    except Exception as e:
        logger.error(f"❌ Playwright failed for {url}: {e}")
        return None


def render_with_playwright_sync(url: str) -> str | None:
    """Synchronous wrapper for Playwright (for thread pool)"""
    try:
        # Create new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            result = loop.run_until_complete(render_with_playwright_async(url))
            return result
        finally:
            loop.close()
            
    except Exception as e:
        logger.error(f"❌ Playwright sync wrapper failed for {url}: {e}")
        return None


def scrape_url(url: str, doc_id: str = None, cancellation_registry: dict = None) -> list:
    """
    Scrape a single URL with cancellation support and Playwright fallback
    """
    # Check cancellation
    if doc_id and cancellation_registry and cancellation_registry.get(doc_id, False):
        logger.info(f"🛑 Skipping {url} - cancelled")
        return None
    
    try:
        logger.info(f"🔍 Fetching URL: {url}")
        downloaded = trafilatura.fetch_url(url)
        
        if not downloaded:
            logger.warning(f"⚠️ Falling back to Playwright (download failed): {url}")
            rendered_html = render_with_playwright_sync(url)
            
            if rendered_html:
                content = trafilatura.extract(rendered_html)
                if not content:
                 raise ValueError(f"No content extracted from: {url}")
                return [Document(page_content=content, metadata={"source": url})]
            
            return []
            
        logger.info(f"📥 Downloaded {len(downloaded)} bytes from {url}")
        
        # Check cancellation after download
        if doc_id and cancellation_registry and cancellation_registry.get(doc_id, False):
            logger.info(f"🛑 Cancelled after download: {url}")
            return None
        
        content = trafilatura.extract(downloaded)
        
        # If no content or very little, try Playwright fallback
        if not content or len(content) < 100:
            logger.warning(f"⚠️ Falling back to Playwright for: {url}")
            
            # Check cancellation before expensive Playwright operation
            if doc_id and cancellation_registry and cancellation_registry.get(doc_id, False):
                logger.info(f"🛑 Cancelled before Playwright: {url}")
                return None
            
            rendered_html = render_with_playwright_sync(url)
            
            if rendered_html:
                content = trafilatura.extract(rendered_html, favor_recall=True)
                logger.info(f"✅ Playwright extracted {len(content)} characters")
            else:
                logger.warning(f"⚠️ Playwright failed, using original content")
        
        if not content:
            logger.warning(f"⚠️ No content extracted from {url}")
            raise ValueError(f"No content extracted from: {url}")
        
        logger.info(f"✅ Extracted {len(content)} characters from {url}")
        
        return [Document(page_content=content, metadata={"source": url})]
        
    except Exception as e:
        logger.error(f"❌ Error scraping {url}: {e}")
        raise ValueError(f"Failed to scrape URL: {url}")


def crawl_website(url: str, max_pages: int, doc_id: str = None, cancellation_registry: dict = None) -> list:
    """
    Crawl website to discover links with cancellation support
    """
    logger.info(f"🕷️ Starting crawl: {url} (max {max_pages} pages)")
    
    # Check cancellation before starting
    if doc_id and cancellation_registry and cancellation_registry.get(doc_id, False):
        logger.info("🛑 Crawl cancelled before start")
        return []
    
    try:
        to_visit, known_links = focused_crawler(url, max_seen_urls=max_pages)
        
        # Check cancellation after crawling
        if doc_id and cancellation_registry and cancellation_registry.get(doc_id, False):
            logger.info("🛑 Crawl cancelled after discovery")
            return []
        
        all_links = list(known_links)
        logger.info(f"✅ Found {len(all_links)} pages to scrape")
        return all_links
        
    except Exception as e:
        logger.error(f"❌ Crawl error: {e}")
        return [url]  # Fallback to just the original URL


def scrape_website(
    url: str,
    max_pages: int,
    max_workers: int = 7,
    doc_id: str = None
) -> list:
    """
    Scrape entire website with cancellation support
    
    Args:
        url: Base URL to scrape
        max_pages: Maximum number of pages to crawl
        max_workers: Number of parallel workers
        doc_id: Document ID for cancellation tracking
    
    Returns:
        List of LangChain Document objects
    """
    start_time = time.time()
    
    # Import cancellation registry from the route
    # This should be passed as parameter or accessed from a shared module
    from routers.documents import cancellation_registry
    
    # Check cancellation before starting
    if doc_id and cancellation_registry.get(doc_id, False):
        logger.info("🛑 Scraping cancelled before start")
        return []
    
    # Discover links
    links = crawl_website(url, max_pages, doc_id, cancellation_registry)
    
    if not links:
        logger.warning("⚠️ No links found to scrape")
        return []
    
    # Check cancellation after crawling
    if doc_id and cancellation_registry.get(doc_id, False):
        logger.info("🛑 Scraping cancelled after crawl")
        return []
    
    logger.info(f"📋 Preparing to scrape {len(links)} pages with {max_workers} workers")
    
    documents = []
    completed_count = 0
    failed_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all scraping tasks
        futures = {
            executor.submit(scrape_url, link, doc_id, cancellation_registry): link 
            for link in links
        }
        
        # Process results as they complete
        for future in as_completed(futures):
            # Check cancellation frequently
            if doc_id and cancellation_registry.get(doc_id, False):
                logger.info(f"🛑 Scraping cancelled - stopping all tasks ({completed_count}/{len(links)} completed)")
                
                # Cancel all pending futures
                for f in futures:
                    if not f.done():
                        f.cancel()
                
                break
            
            try:
                result = future.result(timeout=30)  # 30 second timeout per page
                
                if result is None:
                    # Cancelled during scraping
                    logger.info(f"⏭️ Skipped (cancelled): {futures[future]}")
                    continue
                    
                if result:
                    documents.extend(result)
                    completed_count += 1
                    logger.info(f"✅ [{completed_count}/{len(links)}] Scraped: {futures[future]}")
                else:
                    failed_count += 1
                    logger.warning(f"⚠️ [{completed_count}/{len(links)}] Empty content: {futures[future]}")
                    
            except Exception as e:
                failed_count += 1
                logger.error(f"❌ Failed to scrape {futures[future]}: {e}")

    end_time = time.time()
    duration = end_time - start_time
    
    # Check if was cancelled
    was_cancelled = doc_id and cancellation_registry.get(doc_id, False)
    
    if was_cancelled:
        logger.info(f"🛑 Scraping CANCELLED after {duration:.2f}s")
        logger.info(f"📊 Partial results: {len(documents)} documents from {completed_count} pages")
        return []  # Return empty list for cancelled operations
    else:
        logger.info(f"⏱️ Scraping completed in {duration:.2f} seconds")
        logger.info(f"📊 Results: {len(documents)} documents from {completed_count} pages ({failed_count} failed)")
        
    return documents


# For testing
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    test_url = "https://python.langchain.com/docs/introduction/"
    docs = scrape_website(test_url, max_pages=5)
    
    print(f"\n✅ Scraped {len(docs)} documents")
    if docs:
        print(f"📄 First doc preview: {docs[0].page_content[:200]}...")