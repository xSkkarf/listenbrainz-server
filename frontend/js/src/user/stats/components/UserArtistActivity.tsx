import { ResponsiveBar } from "@nivo/bar";
import * as React from "react";
import { faExclamationCircle, faLink } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { useQuery } from "@tanstack/react-query";
import Card from "../../../components/Card";
import Loader from "../../../components/Loader";
import { COLOR_BLACK } from "../../../utils/constants";
import GlobalAppContext from "../../../utils/GlobalAppContext";

export type UserArtistActivityProps = {
  range: UserStatsAPIRange;
  user?: ListenBrainzUser;
};

export declare type ChartDataItem = {
  label: string;
  [albumName: string]: number | string;
};

export default function UserArtistActivity(props: UserArtistActivityProps) {
  const { APIService } = React.useContext(GlobalAppContext);

  // Props
  const { user, range } = props;

  const { data: loaderData, isLoading: loading } = useQuery({
    queryKey: ["userArtistActivity", user?.name, range],
    queryFn: async () => {
      try {
        const queryData = await APIService.getUserArtistActivity(
          user?.name,
          range
        );
        return { data: queryData, hasError: false, errorMessage: "" };
      } catch (error) {
        return {
          data: { result: [] } as UserArtistActivityResponse,
          hasError: true,
          errorMessage: error.message,
        };
      }
    },
  });

  const {
    data: rawData = { result: [] } as UserArtistActivityResponse,
    hasError = false,
    errorMessage = "",
  } = loaderData || {};

  const processData = (data?: UserArtistActivityResponse) => {
    if (!data || !data.result || data.result.length === 0) {
      return [];
    }
    return data.result.map((artist) => {
      let wrappedLabel = artist.name.replace(/(.{14})/g, "$1-\n");
      if (wrappedLabel.endsWith("-\n")) {
        wrappedLabel = wrappedLabel.slice(0, -2); // Remove the last hyphen and keep the newline
      }
      return {
        label: wrappedLabel,
        ...artist.albums.reduce(
          (acc, album) => ({ ...acc, [album.name]: album.listen_count }),
          {} as Record<string, number>
        ),
      };
    }) as ChartDataItem[];
  };
  const [chartData, setChartData] = React.useState<ChartDataItem[]>([]);

  const albumRedirectMapping = React.useMemo(() => {
    const mapping: Record<string, string> = {};
    if (rawData && rawData.result) {
      rawData.result.forEach((artist) => {
        artist.albums.forEach((album) => {
          if (album.release_group_mbid) {
            mapping[`${artist.name}-${album.name}`] = album.release_group_mbid;
          }
        });
      });
    }
    return mapping;
  }, [rawData]);

  React.useEffect(() => {
    if (rawData && rawData.result.length > 0) {
      const processedData = processData(rawData);
      setChartData(processedData);
    }
  }, [rawData]);

  return (
    <Card className="user-stats-card" data-testid="user-artist-activity">
      <div className="row">
        <div className="col-xs-10">
          <h3 className="capitalize-bold" style={{ marginLeft: 20 }}>
            Artist Activity
          </h3>
        </div>
        <div className="col-xs-2 text-right">
          <h4 style={{ marginTop: 20 }}>
            <a href="#artist-activity">
              <FontAwesomeIcon
                icon={faLink as IconProp}
                size="sm"
                color={COLOR_BLACK}
                style={{ marginRight: 20 }}
              />
            </a>
          </h4>
        </div>
      </div>
      <Loader isLoading={loading}>
        {hasError ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "inherit",
            }}
          >
            <span style={{ fontSize: 24 }}>
              <FontAwesomeIcon icon={faExclamationCircle as IconProp} />{" "}
              {errorMessage}
            </span>
          </div>
        ) : (
          <div className="row">
            <div className="col-xs-12">
              <div
                style={{ width: "100%", height: "600px", minHeight: "400px" }}
              >
                <ResponsiveBar
                  data={chartData}
                  keys={Array.from(
                    new Set(
                      chartData.flatMap((item) =>
                        Object.keys(item).filter((key) => key !== "label")
                      )
                    )
                  )}
                  indexBy="label"
                  margin={{ top: 20, right: 80, bottom: 60, left: 80 }}
                  padding={0.2}
                  layout="vertical"
                  colors={{ scheme: "nivo" }}
                  borderColor={{ from: "color", modifiers: [["darker", 1.6]] }}
                  enableLabel={false}
                  axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    renderTick: (tick) => (
                      <g transform={`translate(${tick.x},${tick.y})`}>
                        {tick.value
                          .split("\n")
                          .map((line: string, i: number) => (
                            <text
                              key={i}
                              x={0}
                              y={10 + i * 15}
                              textAnchor="middle"
                              dominantBaseline="hanging"
                              style={{
                                fontSize: 10,
                                fill: "#000",
                              }}
                            >
                              {line}
                            </text>
                          ))}
                      </g>
                    ),
                  }}
                  onClick={(barData, event) => {
                    const albumName = barData.id;
                    const artistName = barData.indexValue;
                    const releaseMbid =
                      albumRedirectMapping[`${artistName}-${albumName}`];
                    if (releaseMbid) {
                      window.location.href = `/album/${releaseMbid}`;
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </Loader>
    </Card>
  );
}
