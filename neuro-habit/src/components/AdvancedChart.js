import React from 'react';
import { View, Dimensions } from 'react-native';
import { VictoryChart, VictoryBar, VictoryAxis, VictoryTheme } from 'victory-native';

const { width } = Dimensions.get('window');

const AdvancedChart = ({ data, colors }) => {
  if (!data || data.length === 0) return null;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <VictoryChart
        theme={VictoryTheme.material}
        width={width - 40}
        height={220}
        domainPadding={{ x: 20 }}
        padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
      >
        <VictoryAxis
          tickValues={data.map((_, i) => i + 1)}
          tickFormat={data.map((d) => d.day)}
          style={{
            axis: { stroke: colors.border },
            ticks: { stroke: colors.border },
            tickLabels: { fill: colors.subtext, fontSize: 10, padding: 5 }
          }}
        />
        <VictoryAxis
          dependentAxis
          style={{
            axis: { stroke: colors.border },
            ticks: { stroke: colors.border },
            tickLabels: { fill: colors.subtext, fontSize: 10, padding: 5 },
            grid: { stroke: colors.border, strokeDasharray: '4, 4' }
          }}
        />
        <VictoryBar
          data={data}
          x="day"
          y="steps"
          style={{
            data: { 
              fill: colors.primary,
              width: 15,
              borderRadius: 4
            }
          }}
          animate={{
            duration: 1000,
            onLoad: { duration: 500 }
          }}
        />
      </VictoryChart>
    </View>
  );
};

export default AdvancedChart;
