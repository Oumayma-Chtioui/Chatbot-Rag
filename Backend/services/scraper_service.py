import time
import logging
from langchain_core.documents import Document
import trafilatura
from trafilatura.spider import focused_crawler
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

logger = logging.getLogger(__name__)


def scrape_url(url: str, doc_id: str = None) -> list:
    from services.shared_state import cancellation_registry

    # 🔴 Early cancellation check
    if doc_id and cancellation_registry.get(doc_id, False):
        return None

    try:
        logger.info(f"🔍 Fetching URL: {url}")

        # ✅ Add timeout to avoid blocking forever
        downloaded = trafilatura.fetch_url(url)

        if doc_id and cancellation_registry.get(doc_id, False):
            return None

        logger.info(f"🔍 Downloaded content length: {len(downloaded) if downloaded else 0}")

        if not downloaded:
            logger.warning("Skipping empty or failed page")
            return []

        content = trafilatura.extract(downloaded)

        if doc_id and cancellation_registry.get(doc_id, False):
            return None

        logger.info(f"🔍 Extracted content length: {len(content) if content else 0}")

        if not content:
            logger.warning("Skipping empty extracted content")
            return []

        return [Document(page_content=content, metadata={"source": url})]

    except Exception as e:
        logger.error(f"❌ Error scraping {url}: {e}")
        return []


def crawl_website(url: str, max_pages: int) -> list:
    logger.info(f"🕷️ Starting crawl: {url}")
    _, known_links = focused_crawler(url, max_seen_urls=max_pages)

    all_links = list(known_links)

    # ✅ Enforce max_pages strictly
    all_links = all_links[:max_pages]

    logger.info(f"✅ Using {len(all_links)} pages (limited by max_pages)")
    return all_links


def scrape_website(url: str, max_pages: int, max_workers: int, doc_id: str = None) -> list:
    from services.shared_state import cancellation_registry

    start_time = time.time()
    documents = []

    links = crawl_website(url, max_pages)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = set()

        # ✅ Submit tasks progressively instead of all at once
        link_iter = iter(links)

        # Initial batch
        for _ in range(min(max_workers, len(links))):
            try:
                link = next(link_iter)
                futures.add(executor.submit(scrape_url, link, doc_id))
            except StopIteration:
                break

        while futures:
            # ✅ Wait a short time to allow cancellation checks
            done, futures = wait(futures, timeout=0.5, return_when=FIRST_COMPLETED)

            # 🔴 Check cancellation frequently
            if doc_id and cancellation_registry.get(doc_id, False):
                logger.info("🛑 Scraping cancelled by user")

                # Cancel pending tasks (not yet started)
                for f in futures:
                    f.cancel()

                break

            # Process completed tasks
            for future in done:
                try:
                    result = future.result()
                    if result:
                        documents.extend(result)
                except Exception as e:
                    logger.error(f"❌ Task failed: {e}")

                # ✅ Submit next task if available
                try:
                    if not (doc_id and cancellation_registry.get(doc_id, False)):
                        link = next(link_iter)
                        futures.add(executor.submit(scrape_url, link, doc_id))
                except StopIteration:
                    pass

    end_time = time.time()
    logger.info(f"⏱️ Scraping completed in {end_time - start_time:.2f} seconds")
    logger.info(f"✅ Total documents scraped: {len(documents)}")

    return documents