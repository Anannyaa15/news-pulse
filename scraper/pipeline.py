import hashlib
import re
import requests
import feedparser
import trafilatura

from datetime import datetime, timezone, timedelta
from dateutil import parser as date_parser

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from feeds import FEEDS
from database import articles_collection, clusters_collection


# =========================================================
# CONFIGURATION
# =========================================================

HEADERS = {
    "User-Agent": "Mozilla/5.0 NewsPulse/1.0"
}

MAX_ARTICLE_AGE_DAYS = 30

SIMILARITY_THRESHOLD = 0.22

MAX_BODY_CHARS = 5000


STOP = set(
    """
    the a an and or but is are was were to of in on for
    with from by as at this that it its be has have had
    will would could their they them he she his her we
    our you your about after before into over under than
    then there here what when where which while who whom
    these those been being very more most some such only
    also just not no yes
    """.split()
)


# =========================================================
# DATE PARSING
# =========================================================

def parse_date(entry):

    value = (
        entry.get("published")
        or entry.get("updated")
        or entry.get("created")
    )

    if not value:
        return datetime.now(timezone.utc)

    try:

        date = date_parser.parse(value)

        if date.tzinfo is None:
            date = date.replace(
                tzinfo=timezone.utc
            )

        return date.astimezone(
            timezone.utc
        )

    except Exception:

        return datetime.now(timezone.utc)


# =========================================================
# RSS SUMMARY
# =========================================================

def extract_summary(entry):

    value = (
        entry.get("summary")
        or entry.get("description")
        or ""
    )

    if not value and entry.get("content"):
        value = entry["content"][0].get(
            "value",
            ""
        )

    # Remove HTML
    value = re.sub(
        r"<[^>]+>",
        " ",
        value
    )

    # Normalize whitespace
    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip()


# =========================================================
# ARTICLE ID
# =========================================================

def article_id(url):

    return hashlib.sha256(
        url.encode("utf-8")
    ).hexdigest()


# =========================================================
# ARTICLE EXTRACTION
# =========================================================

def extract_article(url):

    try:

        response = requests.get(
            url,
            headers=HEADERS,
            timeout=12
        )

        response.raise_for_status()

        text = trafilatura.extract(
            response.text,
            include_comments=False,
            include_tables=False
        )

        return text or ""

    except Exception as error:

        print(
            f"Extraction failed: {url} "
            f"({error})"
        )

        return ""


# =========================================================
# INGESTION
# =========================================================

def ingest():

    new_articles = 0

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(
            days=MAX_ARTICLE_AGE_DAYS
        )
    )

    for feed in FEEDS:

        print(
            f"Fetching {feed['name']}..."
        )

        try:

            parsed = feedparser.parse(
                feed["url"]
            )

        except Exception as error:

            print(
                f"Feed failed: "
                f"{feed['name']} "
                f"({error})"
            )

            continue


        for entry in parsed.entries:

            title = (
                entry.get(
                    "title",
                    ""
                )
                .strip()
            )

            url = (
                entry.get(
                    "link",
                    ""
                )
                .strip()
            )

            if not title or not url:
                continue


            published_at = parse_date(
                entry
            )


            # Ignore very old RSS entries
            if published_at < cutoff:

                continue


            aid = article_id(url)


            # Duplicate prevention
            existing = (
                articles_collection.find_one(
                    {
                        "article_id": aid
                    },
                    {
                        "_id": 1
                    }
                )
            )

            if existing:
                continue


            article_summary = (
                extract_summary(entry)
            )


            body = extract_article(
                url
            )


            document = {

                "article_id": aid,

                "title": title,

                "summary":
                    article_summary,

                "body":
                    body[:MAX_BODY_CHARS],

                "url": url,

                "source":
                    feed["name"],

                "published_at":
                    published_at,

                "created_at":
                    datetime.now(
                        timezone.utc
                    ),
            }


            try:

                articles_collection.insert_one(
                    document
                )

                new_articles += 1

            except Exception as error:

                print(
                    "Insert skipped:",
                    error
                )


    return new_articles


# =========================================================
# TEXT CLEANING
# =========================================================

def clean_text(text):

    words = re.findall(
        r"\b[a-zA-Z]{3,}\b",
        text.lower()
    )

    words = [
        word
        for word in words
        if word not in STOP
    ]

    return " ".join(words)


# =========================================================
# BUILD ARTICLE TEXT
# =========================================================

def article_text(article):

    title = article.get(
        "title",
        ""
    )

    summary = article.get(
        "summary",
        ""
    )

    body = article.get(
        "body",
        ""
    )

    # Give title and summary stronger influence.
    combined = (
        f"{title} "
        f"{title} "
        f"{summary} "
        f"{summary} "
        f"{body[:MAX_BODY_CHARS]}"
    )

    return clean_text(
        combined
    )


# =========================================================
# CLUSTERING
# =========================================================

def cluster():

    articles = list(
        articles_collection
        .find({})
        .sort(
            {
                "published_at": 1
            }
        )
    )


    if not articles:

        clusters_collection.delete_many({})

        return 0


    texts = [
        article_text(article)
        for article in articles
    ]


    # Remove completely empty documents
    valid_indexes = [
        index
        for index, text in enumerate(texts)
        if text.strip()
    ]


    if not valid_indexes:

        clusters_collection.delete_many({})

        return 0


    valid_articles = [
        articles[index]
        for index in valid_indexes
    ]

    valid_texts = [
        texts[index]
        for index in valid_indexes
    ]


    # =====================================================
    # TF-IDF
    # =====================================================

    vectorizer = TfidfVectorizer(
        max_features=5000,

        min_df=1,

        max_df=0.90,

        ngram_range=(1, 2),

        sublinear_tf=True
    )


    matrix = vectorizer.fit_transform(
        valid_texts
    )


    similarity = cosine_similarity(
        matrix
    )


    # =====================================================
    # GRAPH-BASED GROUPING
    #
    # If A is similar to B and B is similar to C,
    # they can belong to the same topic even if
    # A and C aren't directly similar enough.
    # =====================================================

    threshold = SIMILARITY_THRESHOLD

    visited = set()

    groups = []


    for index in range(
        len(valid_articles)
    ):

        if index in visited:
            continue


        group = []

        queue = [index]

        visited.add(index)


        while queue:

            current = queue.pop()

            group.append(current)


            for other in range(
                len(valid_articles)
            ):

                if other in visited:
                    continue


                if (
                    similarity[
                        current
                    ][other]
                    >= threshold
                ):

                    visited.add(other)

                    queue.append(other)


        groups.append(group)


    # =====================================================
    # REBUILD CLUSTERS
    # =====================================================

    clusters_collection.delete_many({})


    terms = (
        vectorizer
        .get_feature_names_out()
    )


    for number, indexes in enumerate(
        groups,
        start=1
    ):

        selected = [
            valid_articles[index]
            for index in indexes
        ]


        # ---------------------------------------------
        # Determine representative keywords
        # ---------------------------------------------

        group_matrix = matrix[
            indexes
        ]


        scores = (
            group_matrix
            .mean(axis=0)
            .A1
        )


        top_indexes = (
            scores
            .argsort()[-5:][::-1]
        )


        top_terms = [
            terms[index]
            for index in top_indexes
        ]


        label = " • ".join(
            top_terms[:3]
        )


        # ---------------------------------------------
        # Cluster metadata
        # ---------------------------------------------

        article_ids = [
            article["article_id"]
            for article in selected
        ]


        sources = sorted(
            set(
                article["source"]
                for article in selected
            )
        )


        start_time = min(
            article["published_at"]
            for article in selected
        )


        end_time = max(
            article["published_at"]
            for article in selected
        )


        cluster_document = {

            "cluster_id":
                f"cluster-{number}",

            "label":
                label,

            "article_count":
                len(selected),

            "articles":
                article_ids,

            "sources":
                sources,

            "start_time":
                start_time,

            "end_time":
                end_time,

            "created_at":
                datetime.now(
                    timezone.utc
                ),
        }


        clusters_collection.insert_one(
            cluster_document
        )


    return len(groups)


# =========================================================
# MAIN
# =========================================================

def main():

    print(
        "NEWS PULSE PIPELINE"
    )

    print(
        "=" * 50
    )


    new_articles = ingest()


    cluster_count = cluster()


    print(
        f"Completed: "
        f"{new_articles} new articles, "
        f"{cluster_count} clusters"
    )


if __name__ == "__main__":

    main()