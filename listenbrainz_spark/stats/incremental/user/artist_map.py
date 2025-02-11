from typing import List

from listenbrainz_spark.path import ARTIST_COUNTRY_CODE_DATAFRAME
from listenbrainz_spark.stats.incremental.range_selector import ListenRangeSelector
from listenbrainz_spark.stats.incremental.user.artist import ArtistUserEntity
from listenbrainz_spark.stats.incremental.user.entity import UserEntityStatsQueryProvider


class ArtistMapUserEntity(ArtistUserEntity):
    """ See base class QueryProvider for details. """

    def __init__(self, selector: ListenRangeSelector, top_entity_limit: int):
        super().__init__(selector=selector, top_entity_limit=top_entity_limit)

    def get_stats_query(self, final_aggregate, cache_tables: List[str]):
        cache_table = cache_tables[0]
        return f"""
            WITH ranked_stats AS (
                SELECT user_id
                     , artist_name
                     , artist_mbid
                     , listen_count
                     , row_number() OVER (PARTITION BY user_id ORDER BY listen_count DESC) AS rank
                  FROM {final_aggregate}
            )
                SELECT user_id
                     , sort_array(
                            collect_list(
                                struct(
                                    listen_count
                                  , artist_name
                                  , artist_mbid
                                  , country_code
                                )
                            )
                            , false
                       ) as artists
                  FROM ranked_stats
                  JOIN {cache_table}
                 USING (artist_mbid)
                 WHERE rank <= {self.top_entity_limit}
              GROUP BY user_id
        """
