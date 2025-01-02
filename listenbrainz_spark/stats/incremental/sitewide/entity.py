import abc
from datetime import datetime
from pathlib import Path
from typing import List

from pyspark.errors import AnalysisException
from pyspark.sql import DataFrame
from pyspark.sql.types import StructType, StructField, TimestampType

import listenbrainz_spark
from listenbrainz_spark import hdfs_connection
from listenbrainz_spark.path import INCREMENTAL_DUMPS_SAVE_PATH, LISTENBRAINZ_INTERMEDIATE_STATS_DIRECTORY, \
    LISTENBRAINZ_SITEWIDE_STATS_AGG_DIRECTORY, LISTENBRAINZ_SITEWIDE_STATS_BOOKKEEPING_DIRECTORY
from listenbrainz_spark.stats import SITEWIDE_STATS_ENTITY_LIMIT, get_dates_for_stats_range
from listenbrainz_spark.stats.sitewide.entity import get_listen_count_limit
from listenbrainz_spark.utils import read_files_from_HDFS, get_listens_from_dump


BOOKKEEPING_SCHEMA = StructType([
    StructField('from_date', TimestampType(), nullable=False),
    StructField('to_date', TimestampType(), nullable=False),
    StructField('created', TimestampType(), nullable=False),
])


class SitewideEntity(abc.ABC):
    
    def __init__(self, entity):
        self.entity = entity
    
    def get_existing_aggregate_path(self, stats_range) -> str:
        return f"/{LISTENBRAINZ_SITEWIDE_STATS_AGG_DIRECTORY}/{self.entity}/{stats_range}"

    def get_bookkeeping_path(self, stats_range) -> str:
        return f"/{LISTENBRAINZ_SITEWIDE_STATS_BOOKKEEPING_DIRECTORY}/{self.entity}/{stats_range}"

    def get_partial_aggregate_schema(self) -> StructType:
        raise NotImplementedError()

    def aggregate(self, table, cache_tables, user_listen_count_limit) -> DataFrame:
        raise NotImplementedError()

    def combine_aggregates(self, existing_aggregate, incremental_aggregate) -> DataFrame:
        raise NotImplementedError()

    def get_top_n(self, final_aggregate, N) -> DataFrame:
        raise NotImplementedError()

    def get_cache_tables(self) -> List[str]:
        raise NotImplementedError()

    def generate_stats(self, stats_range: str, from_date: datetime,
                       to_date: datetime, top_entity_limit: int = SITEWIDE_STATS_ENTITY_LIMIT):
        user_listen_count_limit = get_listen_count_limit(stats_range)

        cache_dfs = []
        for idx, df_path in enumerate(self.get_cache_tables()):
            df_name = f"entity_data_cache_{idx}"
            cache_dfs.append(df_name)
            read_files_from_HDFS(df_path).createOrReplaceTempView(df_name)

        metadata_path = self.get_bookkeeping_path(stats_range)
        existing_aggregate_usable = False
        try:
            metadata = listenbrainz_spark.session.read.json(metadata_path).collect()[0]
            existing_from_date, existing_to_date = metadata["from_date"], metadata["to_date"]
            existing_aggregate_usable = existing_from_date == from_date
        except AnalysisException:
            pass

        prefix = f"sitewide_{self.entity}_{stats_range}"
        existing_aggregate_path = self.get_existing_aggregate_path(stats_range)

        if not hdfs_connection.client.status(existing_aggregate_path, strict=False) or not existing_aggregate_usable:
            table = f"{prefix}_full_listens"
            get_listens_from_dump(from_date, to_date).createOrReplaceTempView(table)

            hdfs_connection.client.makedirs(Path(existing_aggregate_path).parent)
            full_df = self.aggregate(table, cache_tables, user_listen_count_limit)
            full_df.write.mode("overwrite").parquet(existing_aggregate_path)

            hdfs_connection.client.makedirs(Path(metadata_path).parent)
            metadata_df = listenbrainz_spark.session.createDataFrame(
                [(from_date, to_date, datetime.now())],
                schema=BOOKKEEPING_SCHEMA
            )
            metadata_df.write.mode("overwrite").json(metadata_path)

        full_df = read_files_from_HDFS(existing_aggregate_path)

        if hdfs_connection.client.status(INCREMENTAL_DUMPS_SAVE_PATH, strict=False):
            table = f"{prefix}_incremental_listens"
            read_files_from_HDFS(INCREMENTAL_DUMPS_SAVE_PATH) \
                .createOrReplaceTempView(table)
            inc_df = self.aggregate(table, cache_tables, user_listen_count_limit)
        else:
            inc_df = listenbrainz_spark.session.createDataFrame([], schema=self.get_partial_aggregate_schema())

        full_table = f"{prefix}_existing_aggregate"
        full_df.createOrReplaceTempView(full_table)

        inc_table = f"{prefix}_incremental_aggregate"
        inc_df.createOrReplaceTempView(inc_table)

        combined_df = self.combine_aggregates(full_table, inc_table)
        
        combined_table = f"{prefix}_combined_aggregate"
        combined_df.createOrReplaceTempView(combined_table)
        results_df = self.get_top_n(combined_table, top_entity_limit)

        return results_df.toLocalIterator()
    