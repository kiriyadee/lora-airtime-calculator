import {merge} from 'lodash';
import Plotly, {Data, Layout} from 'plotly.js-basic-dist';
import React, {useCallback, useEffect, useState} from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import {FaRulerHorizontal, FaRulerVertical} from 'react-icons/fa';
import {calculateAirtime} from '../../utils/calculator';
import {getDataRates} from '../../utils/datarates';
import {range} from '../../utils/range';
import {Bandwidth, CodingRate, LoraMode, Region, SpreadingFactor} from '../../utils/types';

interface PlotData extends Partial<Data> {
  visible?: boolean | 'legendonly';
}

interface GraphProps {
  region: Region;
  selectedPacketSize: number;
  codingRate: CodingRate;
}

const Graph: React.FC<GraphProps> = ({region, selectedPacketSize, codingRate}) => {
  const prevRegion = usePrevious(region);
  const prevCodingRate = usePrevious(codingRate);
  const windowWidth = useWindowWidth();

  const [xAxisFitFullRange, setXAxisFitFullRange] = useState(true);
  const [yAxisLogarithmic, setYAxisLogarithmic] = useState(false);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<PlotData[]>([]);
  const [layout, setLayout] = useState<Partial<Layout>>({
    autosize: true,
    margin: {l: 70, t: 0, r: 5},
    dragmode: 'pan',
    xaxis: {
      autorange: false,
      range: [0, 100],
      title: 'PHYPayload Size (bytes)',
      ticks: 'outside',
    },
    yaxis: {
      ticks: 'outside',
      autorange: true,
      fixedrange: true,
      rangemode: 'tozero',
      separatethousands: true,
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.1,
      xanchor: 'left',
      yanchor: 'bottom',
    },
  });

  const preambleLength = 8;
  const explicitHeader = true;
  const lowDataRateOptimize = false;
  const crc = true;

  const updateGraph = useCallback(
    (
      region: Region,
      codingRate: CodingRate,
      spreadingFactor: SpreadingFactor,
      bandwidth: Bandwidth,
      loraMode: LoraMode,
      overhead: number,
      maxPayloadSize: number,
    ) => {
      if (maxPayloadSize > 0) {
        const currentData = [...data];
        const dataRates = getDataRates(region);
        const newData = dataRates.map((dr, idx) => {
          const resetVisibleTraces = codingRate !== prevCodingRate || region !== prevRegion;
          const current = currentData[idx]?.visible;
          const configured = dr.highlight === 'low' ? 'legendonly' : true;
          const visible = resetVisibleTraces ? configured : current ?? configured;

          return {
            name: `DR${dr.value}`,
            x: range(0, maxPayloadSize, 10),
            y: range(0, maxPayloadSize, 10).map((x) =>
              calculateAirtime(
                x + overhead,
                spreadingFactor,
                bandwidth,
                codingRate,
                loraMode,
                preambleLength,
                explicitHeader,
                lowDataRateOptimize,
                crc,
              ),
            ),
            mode: 'lines' as const,
            line: {
              color: dr.color,
              width: dr.highlight === 'high' ? 3 : 1,
            } as const,
            hovertemplate: 'PHYPayload: %{x}B<br>Airtime: %{y}ms',
            visible,
            connectgaps: true,
          };
        });

        setData(newData);
        setRevision((prev) => prev + 1);
      }
    },
    [data, prevCodingRate, prevRegion],
  );

  useEffect(() => {
    if (!codingRate) {
      return;
    }

    updateGraph(
      region,
      codingRate,
      region.spreadingFactors[0],
      region.bandwidths[0],
      region.loraMode,
      5,
      region.maxMacPayloadSize + 5,
    );

    if (region.maxDwellTime) {
      setLayout((current) => {
        const color = 'red';
        return mergeAndTriggerRender(current, {
          shapes: [
            {
              type: 'line',
              x0: 0,
              y0: region.maxDwellTime,
              x1: 1,
              y1: region.maxDwellTime,
              xref: 'paper',
              opacity: 0.2,
              line: {
                color: color,
                width: 2,
                dash: 'dashdot',
              },
            },
          ],
          // Shapes don't support hover text, so add an annotation
          annotations: [
            {
              text: 'max dwell time',
              x: 1,
              xref: 'paper',
              xanchor: 'right',
              y:
                current.yaxis?.type === 'log'
                  ? toLogarithmic(true, region.maxDwellTime)
                  : region.maxDwellTime,
              yanchor: 'bottom',
              showarrow: false,
              font: {
                color: color,
              },
              opacity: 0.4,
            },
          ],
        });
      });
    } else if (prevRegion?.maxDwellTime) {
      setLayout((current) => {
        delete current.shapes;
        delete current.annotations;
        triggerRender();
        return current;
      });
    }
  }, [region, prevRegion, codingRate, selectedPacketSize]);

  useEffect(() => {
    setLayout((current) => {
      return mergeAndTriggerRender(current, {
        yaxis: {
          type: yAxisLogarithmic ? 'log' : 'linear',
          title: yAxisLogarithmic ? 'airtime (ms, logarithmic)' : 'airtime (ms)',
        },
        annotations: current.annotations?.map((annotation) => ({
          y: toLogarithmic(yAxisLogarithmic, annotation.y),
        })),
      });
    });
  }, [yAxisLogarithmic]);

  useEffect(() => {
    setLayout((current) => {
      // 970 - 658 = 312
      const xaxisFixedScaleRange = [0, (windowWidth - 312) / 6];

      const xaxisRange = xAxisFitFullRange
        ? current.xaxis?.range ?? xaxisFixedScaleRange
        : xaxisFixedScaleRange;

      return mergeAndTriggerRender(current, {
        xaxis: {
          autorange: xAxisFitFullRange,
          fixedrange: xAxisFitFullRange,
          range: xaxisRange,
        },
      });
    });
  }, [windowWidth, xAxisFitFullRange]);

  if (!codingRate) {
    return null;
  }

  return (
    <>
      <Plot
        style={{width: '100%', height: '400px'}}
        // See comments above about Plotly mutating `data` and `layout`
        data={data}
        layout={layout}
        revision={revision}
        onUpdate={onUpdate}
        config={{
          // This also needs width: 100% for the <Plot> component
          responsive: true,
          displayModeBar: false,
          showEditInChartStudio: false,
          showTips: false,
        }}
      />
      <ButtonGroup>
        <HelpTooltip
          content={<>Switch between a linear or logarithmic scale for the vertical axis.</>}
        >
          <Button variant="outline-secondary" aria-label="Share" onClick={toggleScale}>
            <FaRulerVertical size="1em" />
            &nbsp;linear / logarithmic
          </Button>
        </HelpTooltip>
        &nbsp;
        <HelpTooltip
          content={
            <>
              Switch between a compressed horizontal range to fit all allowed payload sizes, or a
              scrollable range with a fixed-width scale per payload size.
            </>
          }
        >
          <Button variant="outline-secondary" aria-label="Copy" onClick={toggleFitFullRange}>
            <FaRulerHorizontal size="1em" />
            &nbsp;fit all / scrollable
          </Button>
        </HelpTooltip>
      </ButtonGroup>
    </>
  );
};

export default Graph;
